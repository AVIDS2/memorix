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

/**
 * CLI repeat stress exam: the same command surface must behave identically
 * across repeated in-process invocations — stable exit codes, no id reuse,
 * no state leaks between runs. Deterministic, offline.
 */

const REPEATS = 15;
const originalCwd = process.cwd();
const originalDataDir = process.env.MEMORIX_DATA_DIR;
const originalEmbedding = process.env.MEMORIX_EMBEDDING;
let root = '';
let project = '';

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

describe('CLI repeat stress exam', () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'memorix-stress-cli-'));
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

  it('keeps stable behavior across repeated add/list invocations', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < REPEATS; i++) {
      const added = await runCommand(memoryCommand, {
        _: ['long-term', 'add'],
        title: `repeat ${i}`,
        text: `Repeat run ${i} content.`,
        json: true,
      });
      expect(added.exitCode).toBe(0);
      const memory = JSON.parse(added.stdout).memory;
      expect(memory.state).toBe('qualified');
      expect(ids.has(memory.id)).toBe(false);
      ids.add(memory.id);

      const listed = await runCommand(memoryCommand, { _: ['long-term', 'list'], json: true });
      expect(listed.exitCode).toBe(0);
      const memories = JSON.parse(listed.stdout).memories;
      expect(memories).toHaveLength(i + 1);
      expect(memories.some((item: { memory: { id: string } }) => item.memory.id === memory.id)).toBe(true);
    }
    expect(ids.size).toBe(REPEATS);
  }, 120_000);
});
