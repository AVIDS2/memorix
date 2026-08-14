import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import memoryCommand from '../../src/cli/commands/memory.js';
import purgeCommand from '../../src/cli/commands/purge.js';
import { initObservationStore, getObservationStore, resetObservationStore } from '../../src/store/obs-store.js';
import { getProjectDataDir } from '../../src/store/persistence.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { resetSessionStore } from '../../src/store/session-store.js';
import { resetTeamStore } from '../../src/team/team-store.js';
import { resetDb } from '../../src/store/orama-store.js';

/**
 * Purge exam: wiping memories must have a real CLI entry with an honest
 * confirmation gate. Project-scoped purge leaves other projects alone;
 * --all archives everything. Deterministic, offline, no LLM.
 */

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

describe('purge command exam', () => {
  const originalCwd = process.cwd();
  const originalDataDir = process.env.MEMORIX_DATA_DIR;
  const originalEmbedding = process.env.MEMORIX_EMBEDDING;
  let root = '';
  let projectA = '';
  let projectB = '';
  let dataDir = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'memorix-purge-'));
    projectA = path.join(root, 'project-a');
    projectB = path.join(root, 'project-b');
    dataDir = path.join(root, 'data');
    for (const project of [projectA, projectB]) {
      mkdirSync(project, { recursive: true });
      writeFileSync(path.join(project, 'README.md'), '# test\n', 'utf8');
      execSync('git init', { cwd: project, stdio: 'ignore' });
      execSync('git config user.email test@example.com', { cwd: project, stdio: 'ignore' });
      execSync('git config user.name "Memorix Test"', { cwd: project, stdio: 'ignore' });
    }
    process.chdir(projectA);
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
    rmSync(root, { recursive: true, force: true });
  });

  async function activeObservationCount(projectRoot: string): Promise<number> {
    const { detectProject } = await import('../../src/project/detector.js');
    const project = detectProject(projectRoot)!;
    const dir = await getProjectDataDir(project.id);
    await initObservationStore(dir);
    return (await getObservationStore().loadByProject(project.id, { status: 'active' })).length;
  }

  it('refuses to purge in a non-interactive shell without --yes', async () => {
    const stored = await runCommand(memoryCommand, {
      _: ['store'],
      title: 'Purge gate observation',
      text: 'Must survive the refused purge.',
      entity: 'purge',
      type: 'decision',
      json: true,
    });
    expect(stored.exitCode).toBe(0);

    const refused = await runCommand(purgeCommand, { json: true });
    expect(refused.exitCode).not.toBe(0);
    expect(await activeObservationCount(projectA)).toBe(1);
  });

  it('purges the current project but leaves other projects intact', async () => {
    const stored = await runCommand(memoryCommand, {
      _: ['store'],
      title: 'Purge target observation',
      text: 'Belongs to project A and must be purged.',
      entity: 'purge',
      type: 'decision',
      json: true,
    });
    expect(stored.exitCode).toBe(0);
    const durable = await runCommand(memoryCommand, {
      _: ['long-term', 'add'],
      title: 'Purge target durable',
      text: 'A durable record that purge must retire.',
      json: true,
    });
    expect(durable.exitCode).toBe(0);
    expect(JSON.parse(durable.stdout).memory.state).toBe('qualified');

    process.chdir(projectB);
    const other = await runCommand(memoryCommand, {
      _: ['store'],
      title: 'Other project observation',
      text: 'Belongs to project B and must survive.',
      entity: 'purge',
      type: 'decision',
      json: true,
    });
    expect(other.exitCode).toBe(0);
    process.chdir(projectA);

    const purged = await runCommand(purgeCommand, { yes: true, json: true });
    expect(purged.exitCode).toBe(0);
    const report = JSON.parse(purged.stdout);
    expect(report.observationsArchived).toBeGreaterThanOrEqual(1);
    expect(report.longTermArchived).toBeGreaterThanOrEqual(1);

    expect(await activeObservationCount(projectA)).toBe(0);
    expect(await activeObservationCount(projectB)).toBe(1);

    const listed = await runCommand(memoryCommand, { _: ['long-term', 'list'], json: true });
    expect(JSON.parse(listed.stdout).memories).toHaveLength(0);
  });

  it('--all purges every project', async () => {
    for (const [cwd, title] of [[projectA, 'A observation'], [projectB, 'B observation']] as const) {
      process.chdir(cwd);
      const stored = await runCommand(memoryCommand, {
        _: ['store'],
        title,
        text: title + ' for the all-purge exam.',
        entity: 'purge',
        type: 'decision',
        json: true,
      });
      expect(stored.exitCode).toBe(0);
    }
    process.chdir(projectA);

    const purged = await runCommand(purgeCommand, { all: true, yes: true, json: true });
    expect(purged.exitCode).toBe(0);
    expect(JSON.parse(purged.stdout).observationsArchived).toBeGreaterThanOrEqual(2);
    expect(await activeObservationCount(projectA)).toBe(0);
    expect(await activeObservationCount(projectB)).toBe(0);
  });
});
