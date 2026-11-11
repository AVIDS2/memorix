import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import memoryCommand from '../../src/cli/commands/memory.js';
import transferCommand from '../../src/cli/commands/transfer.js';
import { storeObservation } from '../../src/memory/observations.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { resetSessionStore } from '../../src/store/session-store.js';
import { resetTeamStore } from '../../src/team/team-store.js';
import { resetDb } from '../../src/store/orama-store.js';

async function runCommand(command: any, args: Record<string, unknown>) {
  const logs: string[] = [];
  const errors: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...parts) => logs.push(parts.map(String).join(' ')));
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...parts) => errors.push(parts.map(String).join(' ')));
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;

  try {
    await command.run?.({ args, rawArgs: [], cmd: command } as any);
    return { stdout: logs.join('\n'), stderr: errors.join('\n'), exitCode: process.exitCode ?? 0 };
  } finally {
    process.exitCode = originalExitCode;
    logSpy.mockRestore();
    errSpy.mockRestore();
  }
}

describe('CLI transfer file I/O', () => {
  const originalCwd = process.cwd();
  const originalDataDir = process.env.MEMORIX_DATA_DIR;
  const originalEmbedding = process.env.MEMORIX_EMBEDDING;
  let sandboxRoot = '';
  let repoDir = '';
  let dataDir = '';

  beforeEach(() => {
    sandboxRoot = mkdtempSync(path.join(tmpdir(), 'memorix-cli-transfer-'));
    repoDir = path.join(sandboxRoot, 'repo');
    dataDir = path.join(sandboxRoot, 'data');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(path.join(repoDir, 'README.md'), '# transfer test\n', 'utf8');
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    process.chdir(repoDir);
    process.env.MEMORIX_DATA_DIR = dataDir;
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
    rmSync(sandboxRoot, { recursive: true, force: true });
  });

  it('writes a portable export to a file and accepts that file as an import source', async () => {
    const stored = await runCommand(memoryCommand, {
      _: ['store'],
      text: 'File based exports avoid Windows command line length limits.',
      title: 'CLI file transfer',
      json: true,
    });
    expect(stored.exitCode).toBe(0);

    await storeObservation({
      entityName: 'private-transfer-test',
      type: 'discovery',
      title: 'Personal export exclusion',
      narrative: 'An unbound terminal must not export this record.',
      projectId: 'local/repo',
      visibility: 'personal',
      createdByAgentId: 'another-agent',
    });

    const output = '.memorix-test/export.json';
    const exported = await runCommand(transferCommand, {
      _: ['export'],
      format: 'json',
      out: output,
      json: true,
    });
    expect(exported.exitCode).toBe(0);
    const outputPath = JSON.parse(exported.stdout).outputPath as string;
    expect(existsSync(outputPath)).toBe(true);
    const snapshot = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(snapshot.stats.observationCount).toBe(1);
    expect(snapshot.observations.map((observation: { title: string }) => observation.title)).not.toContain('Personal export exclusion');

    const imported = await runCommand(transferCommand, {
      _: ['import'],
      file: output,
      json: true,
    });
    expect(imported.exitCode).toBe(0);
    expect(JSON.parse(imported.stdout).result).toMatchObject({
      observationsImported: expect.any(Number),
      sessionsImported: expect.any(Number),
    });
  });
});
