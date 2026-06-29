import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import codegraphCommand from '../../src/cli/commands/codegraph.js';
import contextCommand from '../../src/cli/commands/context.js';
import explainCommand from '../../src/cli/commands/explain.js';
import { storeObservation } from '../../src/memory/observations.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { resetDb } from '../../src/store/orama-store.js';
import { resetSessionStore } from '../../src/store/session-store.js';
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

  it('shows a user-facing project context with code memory and suggested reads', async () => {
    await seedProjectContext();

    const result = await runCommand(contextCommand, {});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Project context for repo');
    expect(result.stdout).toContain('Code memory');
    expect(result.stdout).toContain('typescript');
    expect(result.stdout).toContain('python');
    expect(result.stdout).toContain('1 active');
    expect(result.stdout).toContain('src/auth.ts');
    expect(result.stdout).not.toContain('SQLite');
  });

  it('emits structured project context JSON', async () => {
    await seedProjectContext();

    const result = await runCommand(contextCommand, { json: true });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.overview.code.files).toBe(3);
    expect(parsed.overview.code.languages).toEqual([
      { language: 'python', files: 1 },
      { language: 'typescript', files: 2 },
    ]);
    expect(parsed.overview.memory.active).toBe(1);
    expect(parsed.overview.suggestedReads).toContain('src/auth.ts');
  });

  it('explains where the context came from without exposing storage internals', async () => {
    await seedProjectContext();

    const result = await runCommand(explainCommand, {});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Context sources for repo');
    expect(result.stdout).toContain('#1 decision');
    expect(result.stdout).toContain('authMiddleware keeps JWT verification centralized');
    expect(result.stdout).toContain('src/auth.ts');
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
  });
});
