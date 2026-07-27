import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { normalizeHookInput } from '../../src/hooks/normalizer.js';
import { captureCompactionCheckpoint } from '../../src/memory/compaction.js';
import { handleHookEvent } from '../../src/hooks/handler.js';

vi.mock('../../src/config/behavior.js', () => ({
  getBehaviorConfig: () => ({
    sessionInject: 'minimal',
    syncAdvisory: true,
    autoCleanup: true,
    formationMode: 'active',
  }),
}));

describe('hook compaction continuity', () => {
  const originalDataDir = process.env.MEMORIX_DATA_DIR;
  const tempDirs: string[] = [];

  afterEach(() => {
    closeAllDatabases();
    if (originalDataDir === undefined) delete process.env.MEMORIX_DATA_DIR;
    else process.env.MEMORIX_DATA_DIR = originalDataDir;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createRepository(): { repoDir: string; dataDir: string } {
    const root = mkdtempSync(path.join(os.tmpdir(), 'memorix-hook-compact-'));
    const repoDir = path.join(root, 'repo');
    const dataDir = path.join(root, 'data');
    tempDirs.push(root);
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(path.join(repoDir, 'README.md'), '# demo\n', 'utf8');
    execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
    process.env.MEMORIX_DATA_DIR = dataDir;
    return { repoDir, dataDir };
  }

  it('normalizes Codex native manual/auto reasons and Pi native compaction entries', () => {
    const codex = normalizeHookInput({
      _memorix_agent: 'codex',
      hook_event_name: 'PreCompact',
      session_id: 'codex-session',
      cwd: 'E:\\demo',
      trigger: 'auto',
    });
    const pi = normalizeHookInput({
      agent: 'pi',
      hook_event_name: 'pi.session_compact',
      id: 'top-level-session-id-must-not-be-used-as-compact-id',
      session_id: 'pi-session',
      cwd: 'E:\\demo',
      compaction_entry: {
        id: 'pi-entry-1',
        summary: 'Native Pi summary: finish the migration test before release.',
        tokensBefore: 12_000,
        firstKeptEntryId: 'pi-kept-1',
      },
    });

    expect(codex.event).toBe('pre_compact');
    expect(codex.compaction?.reason).toBe('auto');
    expect(pi.event).toBe('post_compact');
    expect(pi.compaction).toMatchObject({
      sourceKey: 'pi-entry-1',
      summary: expect.stringContaining('Native Pi summary'),
      tokensBefore: 12_000,
      firstKeptEntryId: 'pi-kept-1',
    });
  });

  it('captures a pre-compact marker and completes it when the host provides a native summary', async () => {
    const { repoDir } = createRepository();
    const preflight = normalizeHookInput({
      agent: 'pi',
      hook_event_name: 'pi.session_before_compact',
      session_id: 'pi-session',
      cwd: repoDir,
      compaction_reason: 'unknown',
      transcript_path: path.join(repoDir, '.codex', 'transcript.jsonl'),
    });
    const completed = normalizeHookInput({
      agent: 'pi',
      hook_event_name: 'pi.session_compact',
      session_id: 'pi-session',
      cwd: repoDir,
      compaction_entry: {
        id: 'native-entry-2',
        summary: 'Preserve the focused release test and inspect package output before publishing.',
        tokensBefore: 7_500,
      },
    });

    const storedPreflight = await captureCompactionCheckpoint(preflight);
    const storedCompletion = await captureCompactionCheckpoint(completed);

    expect(storedPreflight).toMatchObject({ phase: 'pre', transcriptAvailable: true });
    expect(storedCompletion).toMatchObject({
      id: storedPreflight?.id,
      phase: 'complete',
      captureKind: 'native-summary',
      summary: expect.stringContaining('focused release test'),
    });
  });

  it('uses a compact SessionStart only as lifecycle completion when a host exposes no summary', async () => {
    const { repoDir } = createRepository();
    const preflight = normalizeHookInput({
      _memorix_agent: 'codex',
      hook_event_name: 'PreCompact',
      session_id: 'codex-session',
      cwd: repoDir,
      trigger: 'auto',
    });
    const compactResume = normalizeHookInput({
      _memorix_agent: 'codex',
      hook_event_name: 'SessionStart',
      session_id: 'codex-session',
      cwd: repoDir,
      source: 'compact',
    });

    const storedPreflight = await captureCompactionCheckpoint(preflight);
    const storedCompletion = await captureCompactionCheckpoint(compactResume);

    expect(storedCompletion).toMatchObject({
      id: storedPreflight?.id,
      phase: 'complete',
      captureKind: 'lifecycle',
      reason: 'auto',
    });
    expect(storedCompletion?.summary).toBeUndefined();
  });

  it('delivers a Codex compact checkpoint once through the documented SessionStart context channel', async () => {
    const { repoDir } = createRepository();
    const preflight = normalizeHookInput({
      _memorix_agent: 'codex',
      hook_event_name: 'PreCompact',
      session_id: 'codex-recovery',
      cwd: repoDir,
      trigger: 'manual',
    });
    const compactResume = normalizeHookInput({
      _memorix_agent: 'codex',
      hook_event_name: 'SessionStart',
      session_id: 'codex-recovery',
      cwd: repoDir,
      source: 'compact',
    });

    await captureCompactionCheckpoint(preflight);
    await captureCompactionCheckpoint(compactResume);
    const first = await handleHookEvent(compactResume);
    const second = await handleHookEvent(compactResume);

    expect(first.output.systemMessage).toContain('Memorix recovered one bounded checkpoint');
    expect(first.output.systemMessage).toContain('## Compact Continuation');
    expect(second.output.systemMessage ?? '').not.toContain('## Compact Continuation');
  });

  it('delivers a Claude checkpoint once on the next user prompt without requiring continuation wording', async () => {
    const { repoDir } = createRepository();
    const preflight = normalizeHookInput({
      hook_event_name: 'PreCompact',
      session_id: 'claude-recovery',
      cwd: repoDir,
      trigger: 'auto',
    });
    const compactResume = normalizeHookInput({
      hook_event_name: 'SessionStart',
      session_id: 'claude-recovery',
      cwd: repoDir,
      source: 'compact',
    });
    const nextPrompt = normalizeHookInput({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'claude-recovery',
      cwd: repoDir,
      prompt: 'Please fix the failing authentication regression.',
    });

    await captureCompactionCheckpoint(preflight);
    await captureCompactionCheckpoint(compactResume);
    const first = await handleHookEvent(nextPrompt);
    const second = await handleHookEvent(nextPrompt);

    expect(first.output.systemMessage).toContain('Memorix recovered one bounded checkpoint');
    expect(first.output.systemMessage).toContain('## Compact Continuation');
    expect(second.output.systemMessage ?? '').not.toContain('## Compact Continuation');
  });
});
