import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { CompactionCheckpointStore } from '../../src/store/compaction-checkpoint-store.js';
import { buildCompactionWorkset } from '../../src/memory/compaction.js';

describe('compaction checkpoints', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    closeAllDatabases();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createStore(): CompactionCheckpointStore {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'memorix-checkpoints-'));
    tempDirs.push(dataDir);
    return new CompactionCheckpointStore(dataDir);
  }

  it('merges a host pre-compact marker with its native completion summary', () => {
    const store = createStore();
    const preflight = store.recordPreflight({
      projectId: 'local/demo',
      sessionId: 'codex-session',
      agent: 'codex',
      reason: 'auto',
      sourceEvent: 'PreCompact',
      transcriptAvailable: true,
      capturedAt: '2026-07-27T08:00:00.000Z',
    });

    const completed = store.complete({
      projectId: 'local/demo',
      sessionId: 'codex-session',
      agent: 'codex',
      sourceEvent: 'SessionStart',
      sourceKey: 'codex-native-compact-1',
      summary: 'Keep the auth migration behind the feature flag until the focused test passes.',
      tokensBefore: 8_192,
      firstKeptEntryId: 'entry-42',
      completedAt: '2026-07-27T08:01:00.000Z',
    });

    expect(completed.id).toBe(preflight.id);
    expect(completed.phase).toBe('complete');
    expect(completed.captureKind).toBe('native-summary');
    expect(completed.reason).toBe('auto');
    expect(completed.summary).toContain('auth migration');
    expect(completed.transcriptAvailable).toBe(true);
    expect(completed.tokensBefore).toBe(8_192);
    expect(completed.completedAt).toBe('2026-07-27T08:01:00.000Z');
  });

  it('deduplicates a retried pre-compact hook before host completion', () => {
    const store = createStore();
    const first = store.recordPreflight({
      projectId: 'local/demo',
      sessionId: 'codex-session',
      agent: 'codex',
      sourceEvent: 'PreCompact',
    });
    const retry = store.recordPreflight({
      projectId: 'local/demo',
      sessionId: 'codex-session',
      agent: 'codex',
      sourceEvent: 'PreCompact',
    });

    expect(retry.id).toBe(first.id);
    expect(store.list({ projectId: 'local/demo' })).toHaveLength(1);
  });

  it('deduplicates repeated native completion delivery and supports archiving', () => {
    const store = createStore();
    const first = store.complete({
      projectId: 'local/demo',
      sessionId: 'pi-session',
      agent: 'pi',
      sourceEvent: 'pi.session_compact',
      sourceKey: 'pi-compaction-entry-7',
      summary: 'The retry queue now preserves the original failure reason.',
      tokensBefore: 4_096,
      completedAt: '2026-07-27T08:05:00.000Z',
    });
    const duplicate = store.complete({
      projectId: 'local/demo',
      sessionId: 'pi-session',
      agent: 'pi',
      sourceEvent: 'pi.session_compact',
      sourceKey: 'pi-compaction-entry-7',
      summary: 'The retry queue now preserves the original failure reason.',
      tokensBefore: 4_096,
      completedAt: '2026-07-27T08:05:00.000Z',
    });

    expect(duplicate.id).toBe(first.id);
    expect(store.list({ projectId: 'local/demo' })).toHaveLength(1);

    const archived = store.archive(first.id, '2026-07-27T08:06:00.000Z');
    expect(archived?.status).toBe('archived');
    expect(store.list({ projectId: 'local/demo' })).toHaveLength(0);
    expect(store.list({ projectId: 'local/demo', includeArchived: true })).toHaveLength(1);
  });

  it('keeps repeated lifecycle compactions in one session distinct and each event idempotent', () => {
    const store = createStore();
    const firstPreflight = store.recordPreflight({
      projectId: 'local/demo',
      sessionId: 'codex-session',
      agent: 'codex',
      sourceEvent: 'PreCompact',
    });
    const first = store.complete({
      projectId: 'local/demo',
      sessionId: 'codex-session',
      agent: 'codex',
      sourceEvent: 'SessionStart',
    });
    const duplicate = store.complete({
      projectId: 'local/demo',
      sessionId: 'codex-session',
      agent: 'codex',
      sourceEvent: 'SessionStart',
    });
    const secondPreflight = store.recordPreflight({
      projectId: 'local/demo',
      sessionId: 'codex-session',
      agent: 'codex',
      sourceEvent: 'PreCompact',
    });
    const second = store.complete({
      projectId: 'local/demo',
      sessionId: 'codex-session',
      agent: 'codex',
      sourceEvent: 'SessionStart',
    });

    expect(first.id).toBe(firstPreflight.id);
    expect(duplicate.id).toBe(first.id);
    expect(second.id).toBe(secondPreflight.id);
    expect(second.id).not.toBe(first.id);
    expect(store.list({ projectId: 'local/demo', sessionId: 'codex-session' })).toHaveLength(2);
  });

  it('builds a bounded continuation workset without replaying the full native summary', () => {
    const store = createStore();
    const checkpoint = store.complete({
      projectId: 'local/demo',
      sessionId: 'pi-session',
      agent: 'pi',
      sourceEvent: 'pi.session_compact',
      sourceKey: 'pi-compaction-entry-8',
      summary: Array.from({ length: 120 }, (_, index) => `Decision ${index}: keep current code authoritative.`).join('\n'),
      completedAt: '2026-07-27T08:10:00.000Z',
    });

    const workset = buildCompactionWorkset(checkpoint, {
      task: 'Continue the auth migration safely',
      maxTokens: 80,
    });

    expect(workset.tokens).toBeLessThanOrEqual(80);
    expect(workset.text).toContain('## Compact Continuation');
    expect(workset.text).toContain('Current code remains authoritative.');
    expect(workset.text.length).toBeLessThan(checkpoint.summary!.length);
  });
});
