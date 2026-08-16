import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'citty';
import codegraphCommand from '../../src/cli/commands/codegraph.js';
import contextCommand from '../../src/cli/commands/context.js';
import doctorCommand from '../../src/cli/commands/doctor.js';
import explainCommand from '../../src/cli/commands/explain.js';
import resumeCommand from '../../src/cli/commands/resume.js';
import { resetResolvedConfigCache } from '../../src/config/resolved-config.js';
import { resetTomlConfigCache } from '../../src/config/toml-loader.js';
import { initObservations, storeObservation } from '../../src/memory/observations.js';
import { endSession, startSession } from '../../src/memory/session.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { resetDb } from '../../src/store/orama-store.js';
import { initSessionStore, resetSessionStore } from '../../src/store/session-store.js';
import { resetTeamStore } from '../../src/team/team-store.js';

async function runCommand(command: any, args: Record<string, unknown>) {
  const logs: string[] = [];
  const errors: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...parts) => logs.push(parts.map(String).join(' ')));
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...parts) => errors.push(parts.map(String).join(' ')));
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;

  try {
    await command.run?.({ args, rawArgs: [], cmd: command } as any);
    return {
      stdout: logs.join('\n'),
      stderr: errors.join('\n'),
      exitCode: process.exitCode ?? 0,
    };
  } finally {
    process.exitCode = originalExitCode;
    logSpy.mockRestore();
    errSpy.mockRestore();
  }
}

describe('project context CLI commands', () => {
  const originalCwd = process.cwd();
  const originalDataDir = process.env.MEMORIX_DATA_DIR;
  const originalEmbedding = process.env.MEMORIX_EMBEDDING;
  let sandboxRoot = '';
  let repoDir = '';
  let dataDir = '';

  beforeEach(() => {
    sandboxRoot = mkdtempSync(path.join(tmpdir(), 'memorix-context-cli-'));
    repoDir = path.join(sandboxRoot, 'repo');
    dataDir = path.join(sandboxRoot, 'data');
    mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    writeFileSync(path.join(repoDir, 'src', 'jwt.ts'), 'export function verifyJwt(token: string) { return token.length > 0; }\n', 'utf8');
    writeFileSync(path.join(repoDir, 'src', 'auth.ts'), "import { verifyJwt } from './jwt';\nexport function authMiddleware(token: string) { return verifyJwt(token); }\n", 'utf8');
    writeFileSync(path.join(repoDir, 'src', 'worker.py'), 'def dispatch_job(name: str):\n    return name.upper()\n', 'utf8');
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    process.chdir(repoDir);
    process.env.MEMORIX_DATA_DIR = dataDir;
    process.env.MEMORIX_EMBEDDING = 'off';
    resetTomlConfigCache();
    resetResolvedConfigCache();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalDataDir === undefined) {
      delete process.env.MEMORIX_DATA_DIR;
    } else {
      process.env.MEMORIX_DATA_DIR = originalDataDir;
    }
    if (originalEmbedding === undefined) {
      delete process.env.MEMORIX_EMBEDDING;
    } else {
      process.env.MEMORIX_EMBEDDING = originalEmbedding;
    }
    resetObservationStore();
    resetSessionStore();
    resetTeamStore();
    resetTomlConfigCache();
    resetResolvedConfigCache();
    await resetDb();
    closeAllDatabases();
    rmSync(sandboxRoot, { recursive: true, force: true });
  });

  async function seedProjectContext() {
    await runCommand(codegraphCommand, { _: ['refresh'], json: true });
    await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'authMiddleware keeps JWT verification centralized',
      narrative: 'Continue edits in src/auth.ts when changing login verification.',
      filesModified: ['src/auth.ts'],
      projectId: 'local/repo',
    });
  }

  async function seedMemoryOnly() {
    await initObservations(dataDir);
    await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'authMiddleware keeps JWT verification centralized',
      narrative: 'Continue edits in src/auth.ts when changing login verification.',
      filesModified: ['src/auth.ts'],
      projectId: 'local/repo',
    });
  }

  it('accepts --task without requiring the ergonomic positional task', () => {
    const args = parseArgs(
      ['--task', 'prepare the release'],
      contextCommand.args as Record<string, { type?: 'boolean' | 'string' | 'positional'; required?: boolean }>,
    );

    expect(args.task).toBe('prepare the release');
    expect(args.input).toBeUndefined();
  });

  it('auto-refreshes code memory when context runs before a manual scan', async () => {
    await seedMemoryOnly();

    const result = await runCommand(contextCommand, { json: true });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.overview.code.files).toBe(3);
    expect(parsed.overview.code.languages).toEqual([
      { language: 'python', files: 1 },
      { language: 'typescript', files: 2 },
    ]);
    expect(parsed.overview.suggestedReads).toContain('src/auth.ts');
  });

  it('shows a user-facing project context with code memory and suggested reads', async () => {
    await seedProjectContext();

    const result = await runCommand(contextCommand, {});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Memorix Autopilot Brief');
    expect(result.stdout).toContain('Project state');
    expect(result.stdout).toContain('Reliable memory');
    expect(result.stdout).toContain('Start here');
    expect(result.stdout).toContain('Task lens: general');
    expect(result.stdout).toContain('src/auth.ts');
    expect(result.stdout).not.toContain('SQLite');
  });

  it('emits structured project context JSON', async () => {
    writeFileSync(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ name: 'repo', version: '9.9.9' }, null, 2),
      'utf8',
    );
    writeFileSync(
      path.join(repoDir, 'CHANGELOG.md'),
      '# Changelog\n\n## [9.9.9] - 2026-07-02\n',
      'utf8',
    );
    await seedProjectContext();

    const result = await runCommand(contextCommand, { json: true, task: 'prepare release 9.9.9' });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.lens).toMatchObject({
      id: 'release',
      description: expect.stringContaining('release'),
    });
    expect(parsed.brief).toMatchObject({
      lens: 'release',
      startHere: expect.arrayContaining(['CHANGELOG.md', 'package.json']),
      suggestedVerification: expect.arrayContaining([
        expect.stringContaining('package metadata'),
      ]),
    });
    expect(parsed.overview.code.files).toBe(3);
    expect(parsed.overview.code.languages).toEqual([
      { language: 'python', files: 1 },
      { language: 'typescript', files: 2 },
    ]);
    expect(parsed.overview.memory.active).toBe(1);
    expect(parsed.overview.suggestedReads).toContain('src/auth.ts');
    expect(parsed.currentFacts.packageVersion).toBe('9.9.9');
    expect(parsed.currentFacts.latestChangelog).toEqual({ version: '9.9.9', date: '2026-07-02' });
    expect(parsed.workset).toMatchObject({
      version: '1.3',
      lens: 'release',
      startHere: expect.arrayContaining(['CHANGELOG.md', 'package.json']),
    });
    expect(parsed.providerQuality).toMatchObject({
      selected: 'lite',
      selectedQuality: 'heuristic',
      external: { state: 'not-detected' },
    });
    expect(parsed.workset.budget.tokenCount).toBeLessThanOrEqual(parsed.workset.budget.maxTokens);
  });

  it('emits a bounded receipt without the detailed stores when brief JSON is requested', async () => {
    await seedProjectContext();

    const result = await runCommand(contextCommand, {
      task: 'continue the auth fix',
      refresh: 'never',
      briefJson: true,
      agent: 'codex',
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toMatchObject({
      schemaVersion: '1',
      task: 'continue the auth fix',
      brief: expect.stringContaining('Memorix Autopilot Brief'),
      receipt: expect.objectContaining({ target: 'project-context' }),
      code: expect.objectContaining({ selected: 'lite', quality: 'heuristic' }),
      loadout: expect.objectContaining({ agent: 'codex' }),
    });
    expect(parsed.overview).toBeUndefined();
    expect(parsed.currentFacts).toBeUndefined();
    expect(parsed.workset).toBeUndefined();
  });

  it('explains where the context came from without exposing storage internals', async () => {
    await seedProjectContext();

    const result = await runCommand(explainCommand, {});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Context sources for repo');
    expect(result.stdout).toContain('#1 decision');
    expect(result.stdout).toContain('authMiddleware keeps JWT verification centralized');
    expect(result.stdout).toContain('src/auth.ts');
    expect(result.stdout).toContain('Context delivery receipt');
    expect(result.stdout).toContain('Target: Project Context');
    expect(result.stdout).not.toContain('SQLite');
  });

  it('emits structured source provenance JSON', async () => {
    await seedProjectContext();

    const result = await runCommand(explainCommand, { json: true });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.explain.sources[0]).toMatchObject({
      observationId: 1,
      title: 'authMiddleware keeps JWT verification centralized',
      type: 'decision',
      path: 'src/auth.ts',
      status: 'current',
    });
    expect(parsed.explain.overview.code.files).toBe(3);
    expect(parsed.receipt).toMatchObject({
      version: '1.3',
      target: 'project-context',
      budget: {
        maxTokens: expect.any(Number),
        tokenCount: expect.any(Number),
      },
    });
  });

  it('uses one positional context call to resume a prior session and durable unbound memory', async () => {
    await initObservations(dataDir);
    await initSessionStore(dataDir);
    await storeObservation({
      entityName: 'auth-rollover',
      type: 'decision',
      title: 'JWT refresh rollout remains behind the auth flag',
      narrative: 'Keep the refresh rollout behind AUTH_REFRESH_V2 until the migration test is green.',
      facts: ['Next step: run the focused auth migration test before changing the flag.'],
      projectId: 'local/repo',
    });
    await startSession(dataDir, 'local/repo', { sessionId: 'claude-auth', agent: 'claude-code' });
    await endSession(
      dataDir,
      'claude-auth',
      '## Goal\nContinue the JWT refresh rollout.\n\n## Next\nRun the focused auth migration test before changing the flag.',
    );

    const result = await runCommand(contextCommand, {
      input: 'continue the JWT refresh rollout',
      refresh: 'never',
      json: true,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.task).toBe('continue the JWT refresh rollout');
    expect(parsed.workset.prompt).toContain('Resume from prior work');
    expect(parsed.workset.prompt).toContain('Continue the JWT refresh rollout');
    expect(parsed.workset.prompt).toContain('JWT refresh rollout remains behind the auth flag');
    expect(parsed.workset.receipt.selected).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'continuation', id: 'session:claude-auth' }),
    ]));
    expect(parsed.continuation.previousSession).toMatchObject({
      id: 'claude-auth',
      agent: 'claude-code',
    });
  });

  it('uses the explicit resume command without requiring a command-discovery loop', async () => {
    await initObservations(dataDir);
    await initSessionStore(dataDir);
    await storeObservation({
      entityName: 'auth-rollover',
      type: 'decision',
      title: 'JWT refresh rollout remains behind the auth flag',
      narrative: 'Keep the refresh rollout behind AUTH_REFRESH_V2 until the migration test is green.',
      projectId: 'local/repo',
    });
    await startSession(dataDir, 'local/repo', { sessionId: 'codex-auth', agent: 'codex' });
    await endSession(dataDir, 'codex-auth', 'Run the focused auth migration test before changing the flag.');

    const result = await runCommand(resumeCommand, {
      task: 'finish fixing the JWT refresh rollout',
      refresh: 'never',
      json: true,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.task).toBe('finish fixing the JWT refresh rollout');
    expect(parsed.workset.prompt).toContain('Resume from prior work');
    expect(parsed.workset.prompt).toContain('JWT refresh rollout remains behind the auth flag');
    expect(parsed.workset.receipt.selected).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'continuation', id: 'session:codex-auth' }),
    ]));
  });

  it('forwards bounded receipt and agent options through the resume shortcut', async () => {
    const result = await runCommand(resumeCommand, {
      task: 'continue the auth fix',
      refresh: 'never',
      briefJson: true,
      agent: 'codex',
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.schemaVersion).toBe('1');
    expect(parsed.loadout?.agent).toBe('codex');
    expect(parsed).not.toHaveProperty('overview');
    expect(parsed).not.toHaveProperty('workset');
  });

  it('does not inject prior-work context for an unrelated new task', async () => {
    await initObservations(dataDir);
    await initSessionStore(dataDir);
    await startSession(dataDir, 'local/repo', { sessionId: 'old-auth', agent: 'claude-code' });
    await endSession(dataDir, 'old-auth', 'Continue the old authentication rollout.');

    const result = await runCommand(contextCommand, {
      input: 'document the current worker API',
      refresh: 'never',
      json: true,
    });

    const parsed = JSON.parse(result.stdout);
    expect(parsed.workset.prompt).not.toContain('Resume from prior work');
    expect(parsed.continuation).toBeUndefined();
  });

  it('includes code memory health in doctor JSON', async () => {
    await seedProjectContext();

    const result = await runCommand(doctorCommand, { json: true });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.codeMemory).toMatchObject({
      provider: 'lite',
      files: 3,
      symbols: 3,
      refs: 2,
      freshness: {
        current: 2,
        suspect: 0,
        stale: 0,
      },
      providerQuality: {
        selected: 'lite',
        external: { state: 'not-detected' },
      },
    });
    expect(parsed.lifecycle).toMatchObject({
      maintenance: { summary: expect.any(Object) },
      claims: { total: expect.any(Number) },
      workspaces: expect.any(Array),
      workflows: expect.any(Object),
    });
  });

  it('applies CodeGraph excludes to doctor suggested reads', async () => {
    mkdirSync(path.join(repoDir, 'vendor', 'cache'), { recursive: true });
    writeFileSync(path.join(repoDir, 'vendor', 'cache', 'tool.ts'), 'export function cachedTool() { return true; }\n', 'utf8');
    await runCommand(codegraphCommand, { _: ['refresh'], json: true });
    await initObservations(dataDir);
    await storeObservation({
      entityName: 'cache',
      type: 'decision',
      title: 'Vendor cache tool',
      narrative: 'Keep vendor/cache/tool.ts for cache behavior.',
      filesModified: ['vendor/cache/tool.ts'],
      projectId: 'local/repo',
    });
    await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'Auth middleware',
      narrative: 'Continue edits in src/auth.ts when changing login verification.',
      filesModified: ['src/auth.ts'],
      projectId: 'local/repo',
    });
    writeFileSync(path.join(repoDir, 'memorix.toml'), '[codegraph]\nexclude_patterns = ["vendor/**"]\n', 'utf8');
    resetTomlConfigCache();
    resetResolvedConfigCache();

    const result = await runCommand(doctorCommand, {});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('src/auth.ts');
    expect(result.stdout).not.toContain('vendor/cache/tool.ts');
  });

  it('scopes doctor observation counts to the current project', async () => {
    await initObservations(dataDir);
    await storeObservation({
      entityName: 'current-project',
      type: 'decision',
      title: 'Current project memory',
      narrative: 'This should be counted by doctor for local/repo.',
      projectId: 'local/repo',
    });
    await storeObservation({
      entityName: 'other-project',
      type: 'decision',
      title: 'Other project memory',
      narrative: 'This should not affect current project diagnostics.',
      projectId: 'other/project',
    });

    const result = await runCommand(doctorCommand, { json: true });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.data).toMatchObject({
      observations: 1,
      active: 1,
    });
  });
});
