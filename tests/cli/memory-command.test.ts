import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import memoryCommand from '../../src/cli/commands/memory.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { resetSessionStore } from '../../src/store/session-store.js';
import { resetTeamStore } from '../../src/team/team-store.js';
import { resetDb } from '../../src/store/orama-store.js';

async function runCommand(command: any, args: Record<string, unknown>) {
  const logs: string[] = [];
  const errors: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...parts) => logs.push(parts.map(String).join(' ')));
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...parts) => errors.push(parts.map(String).join(' ')));
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await command.run?.({ args, rawArgs: [], cmd: command } as any);
    return { stdout: logs.join('\n'), stderr: errors.join('\n'), exitCode: process.exitCode ?? 0 };
  } finally {
    process.exitCode = previousExitCode;
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }
}

describe('memory store CLI argument coercion', () => {
  const originalCwd = process.cwd();
  const originalDataDir = process.env.MEMORIX_DATA_DIR;
  const originalEmbedding = process.env.MEMORIX_EMBEDDING;
  let root = '';
  let project = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'memorix-memory-cli-'));
    project = path.join(root, 'project');
    mkdirSync(project, { recursive: true });
    writeFileSync(path.join(project, 'README.md'), '# test\n', 'utf8');
    execSync('git init', { cwd: project, stdio: 'ignore' });
    execSync('git config user.email test@example.com', { cwd: project, stdio: 'ignore' });
    execSync('git config user.name "Memorix Test"', { cwd: project, stdio: 'ignore' });
    process.chdir(project);
    process.env.MEMORIX_DATA_DIR = path.join(root, 'data');
    process.env.MEMORIX_EMBEDDING = 'off';
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalDataDir === undefined) delete process.env.MEMORIX_DATA_DIR;
    else process.env.MEMORIX_DATA_DIR = originalDataDir;
    if (originalEmbedding === undefined) delete process.env.MEMORIX_EMBEDDING;
    else process.env.MEMORIX_EMBEDDING = originalEmbedding;
    resetObservationStore();
    resetSessionStore();
    resetTeamStore();
    await resetDb();
    closeAllDatabases();
    rmSync(root, { recursive: true, force: true });
  });

  it('stores a joined narrative when --text arrives as a repeated-flag array', async () => {
    // Citty accumulates repeated string flags into an array, and Windows
    // PowerShell 5.1 can split one long quoted argument into argv fragments
    // that re-introduce the flag mid-value. See issue #194.
    const result = await runCommand(memoryCommand, {
      _: ['store'],
      text: ['opencode upgrade: run', 'upgrade note after the quoted section'],
      json: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('named?.trim');
    const parsed = JSON.parse(result.stdout);
    expect(parsed.observation.narrative).toBe(
      'opencode upgrade: run upgrade note after the quoted section',
    );
  });

  it('coerces repeated scalar flags on the store path instead of throwing a TypeError', async () => {
    const result = await runCommand(memoryCommand, {
      _: ['store'],
      text: ['fragment one', 'fragment two'],
      title: ['Upgrade', 'note'],
      topicKey: ['upgrade', 'note'],
      entity: ['cli', 'memory'],
      facts: ['a,b', 'c'],
      json: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const parsed = JSON.parse(result.stdout);
    expect(parsed.observation.narrative).toBe('fragment one fragment two');
    expect(parsed.observation.title).toBe('Upgrade note');
    expect(parsed.observation.topicKey).toBe('upgrade note');
    expect(parsed.observation.entityName).toBe('cli memory');
    expect(parsed.observation.facts).toEqual(['a', 'b', 'c']);
  });
});
