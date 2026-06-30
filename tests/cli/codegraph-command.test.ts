import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import codegraphCommand from '../../src/cli/commands/codegraph.js';
import { initObservations, storeObservation } from '../../src/memory/observations.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { initObservationStore, resetObservationStore } from '../../src/store/obs-store.js';
import { resetDb } from '../../src/store/orama-store.js';
import { resetSessionStore } from '../../src/store/session-store.js';
import { resetTeamStore } from '../../src/team/team-store.js';

async function runCommand(args: Record<string, unknown>) {
  const logs: string[] = [];
  const errors: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...parts) => logs.push(parts.map(String).join(' ')));
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...parts) => errors.push(parts.map(String).join(' ')));
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;

  try {
    await codegraphCommand.run?.({ args, rawArgs: [], cmd: codegraphCommand } as any);
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

describe('codegraph CLI command', () => {
  const originalCwd = process.cwd();
  const originalDataDir = process.env.MEMORIX_DATA_DIR;
  const originalEmbedding = process.env.MEMORIX_EMBEDDING;
  let sandboxRoot = '';
  let repoDir = '';
  let dataDir = '';

  beforeEach(() => {
    sandboxRoot = mkdtempSync(path.join(tmpdir(), 'memorix-codegraph-cli-'));
    repoDir = path.join(sandboxRoot, 'repo');
    dataDir = path.join(sandboxRoot, 'data');
    mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    writeFileSync(path.join(repoDir, 'src', 'jwt.ts'), 'export function verifyJwt(token: string) { return token.length > 0; }\n', 'utf8');
    writeFileSync(path.join(repoDir, 'src', 'auth.ts'), "import { verifyJwt } from './jwt';\nexport function authMiddleware(token: string) { return verifyJwt(token); }\n", 'utf8');
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    process.chdir(repoDir);
    process.env.MEMORIX_DATA_DIR = dataDir;
    process.env.MEMORIX_EMBEDDING = 'off';
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
    await resetDb();
    closeAllDatabases();
    rmSync(sandboxRoot, { recursive: true, force: true });
  });

  it('refreshes the lite index and reports status as JSON', async () => {
    const refreshed = await runCommand({ _: ['refresh'], json: true });
    expect(refreshed.exitCode).toBe(0);
    const refreshJson = JSON.parse(refreshed.stdout);
    expect(refreshJson.status.files).toBe(2);
    expect(refreshJson.status.symbols).toBe(2);
    expect(refreshJson.status.edges).toBe(1);

    const status = await runCommand({ _: ['status'], json: true });
    expect(status.exitCode).toBe(0);
    const statusJson = JSON.parse(status.stdout);
    expect(statusJson.status).toMatchObject({
      provider: 'lite',
      files: 2,
      symbols: 2,
      edges: 1,
    });
  });

  it('shows primary usage hints with the default status output', async () => {
    const result = await runCommand({});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('memorix codegraph refresh');
    expect(result.stdout).toContain('memorix codegraph context-pack --task');
  });

  it('keeps explicit text status output focused on status only', async () => {
    const result = await runCommand({ _: ['status'] });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('CodeGraph Memory: lite');
    expect(result.stdout).not.toContain('Usage:');
  });

  it('builds a context pack from code-bound memories', async () => {
    await runCommand({ _: ['refresh'], json: true });
    await initObservationStore(dataDir);
    await initObservations(dataDir);
    await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'authMiddleware uses jose',
      narrative: 'Keep authMiddleware in src/auth.ts.',
      filesModified: ['src/auth.ts'],
      projectId: 'local/repo',
    });

    const result = await runCommand({ _: ['context-pack'], task: 'continue auth bug' });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('## Task');
    expect(result.stdout).toContain('authMiddleware');
    expect(result.stdout).toContain('src/auth.ts');
  });

  it('backfills existing memories during refresh before building a context pack', async () => {
    await initObservationStore(dataDir);
    await initObservations(dataDir);
    await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'authMiddleware uses jose',
      narrative: 'Keep authMiddleware in src/auth.ts.',
      filesModified: ['src/auth.ts'],
      projectId: 'local/repo',
    });

    await runCommand({ _: ['refresh'], json: true });
    const result = await runCommand({ _: ['context-pack'], task: 'continue authMiddleware bug' });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('#1 current');
    expect(result.stdout).toContain('src/auth.ts');
  });

  it('keeps old refs stale after a file disappears on refresh', async () => {
    await runCommand({ _: ['refresh'], json: true });
    await initObservationStore(dataDir);
    await initObservations(dataDir);
    await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'authMiddleware uses jose',
      narrative: 'Keep authMiddleware in src/auth.ts.',
      filesModified: ['src/auth.ts'],
      projectId: 'local/repo',
    });

    unlinkSync(path.join(repoDir, 'src', 'auth.ts'));
    await runCommand({ _: ['refresh'], json: true });
    const result = await runCommand({ _: ['context-pack'], task: 'continue authMiddleware bug' });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('## Freshness Warnings');
    expect(result.stdout).toContain('#1 stale');
    expect(result.stdout).toContain('referenced file is no longer indexed');
  });

  it('chooses task-relevant memories before recent unrelated memories', async () => {
    await runCommand({ _: ['refresh'], json: true });
    await initObservationStore(dataDir);
    await initObservations(dataDir);
    await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'authMiddleware uses jose',
      narrative: 'Keep authMiddleware in src/auth.ts.',
      filesModified: ['src/auth.ts'],
      projectId: 'local/repo',
    });
    await storeObservation({
      entityName: 'dashboard',
      type: 'decision',
      title: 'Dashboard stays simple',
      narrative: 'Keep the dashboard route boring.',
      filesModified: [],
      projectId: 'local/repo',
    });

    const result = await runCommand({ _: ['context-pack'], task: 'continue authMiddleware bug', limit: '1' });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('authMiddleware');
    expect(result.stdout).not.toContain('Dashboard stays simple');
  });
});
