import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import memoryCommand from '../../src/cli/commands/memory.js';
import contextCommand from '../../src/cli/commands/context.js';
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

describe('long-term memory CLI', () => {
  const originalCwd = process.cwd();
  const originalDataDir = process.env.MEMORIX_DATA_DIR;
  const originalEmbedding = process.env.MEMORIX_EMBEDDING;
  let root = '';
  let projectA = '';
  let projectB = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'memorix-long-term-cli-'));
    projectA = path.join(root, 'project-a');
    projectB = path.join(root, 'project-b');
    for (const project of [projectA, projectB]) {
      mkdirSync(project, { recursive: true });
      writeFileSync(path.join(project, 'README.md'), '# test\n', 'utf8');
      execSync('git init', { cwd: project, stdio: 'ignore' });
      execSync('git config user.email test@example.com', { cwd: project, stdio: 'ignore' });
      execSync('git config user.name "Memorix Test"', { cwd: project, stdio: 'ignore' });
    }
    process.chdir(projectA);
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

  it('manages an explicit portable user memory through the full lifecycle and delivers it in another project', async () => {
    const created = await runCommand(memoryCommand, {
      _: ['long-term', 'add'],
      title: 'Verify package before release',
      text: 'Run the focused package smoke before publishing an npm release.',
      kind: 'procedural',
      scope: 'user',
      portability: 'portable',
      tags: 'release,package',
      applicability: 'When publishing any local npm package.',
      json: true,
    });
    expect(created.exitCode).toBe(0);
    const candidate = JSON.parse(created.stdout).memory;
    // An operator-written record carries its own source evidence and
    // auto-qualifies; approval remains a deliberate review step.
    expect(candidate.state).toBe('qualified');

    const approved = await runCommand(memoryCommand, {
      _: ['long-term', 'approve'],
      id: candidate.id,
      reason: 'Operator reviewed the portable user procedure.',
      json: true,
    });
    expect(JSON.parse(approved.stdout).memory.state).toBe('approved');

    const shown = await runCommand(memoryCommand, { _: ['long-term', 'show'], id: candidate.id, json: true });
    expect(JSON.parse(shown.stdout).evidence).toHaveLength(1);
    expect(JSON.parse(shown.stdout).events.map((event: { kind: string }) => event.kind)).toEqual(['created', 'qualified', 'approved']);

    process.chdir(projectB);
    const context = await runCommand(contextCommand, {
      input: 'Prepare an npm release and verify the package.',
      refresh: 'never',
      json: true,
    });
    expect(context.exitCode).toBe(0);
    expect(JSON.parse(context.stdout).workset.durableMemory).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: candidate.id, scope: 'user', kind: 'procedural' }),
    ]));

    process.chdir(projectA);
    const archived = await runCommand(memoryCommand, {
      _: ['long-term', 'archive'],
      id: candidate.id,
      reason: 'The procedure was replaced by a newer one.',
      json: true,
    });
    expect(JSON.parse(archived.stdout).memory.state).toBe('archived');
    const listed = await runCommand(memoryCommand, { _: ['long-term', 'list'], json: true });
    expect(JSON.parse(listed.stdout).memories).toHaveLength(0);
  }, 30000);

  it('promotes an observation without removing its source record', async () => {
    const stored = await runCommand(memoryCommand, {
      _: ['store'],
      title: 'Release smoke source observation',
      text: 'The package smoke is the final release verification gate.',
      entity: 'release',
      type: 'decision',
      json: true,
    });
    const observation = JSON.parse(stored.stdout).observation;

    const promoted = await runCommand(memoryCommand, {
      _: ['long-term', 'promote'],
      fromObservation: String(observation.id),
      kind: 'procedural',
      scope: 'project',
      applicability: 'When preparing the package release.',
      json: true,
    });
    expect(promoted.exitCode).toBe(0);
    const memory = JSON.parse(promoted.stdout).memory;
    // An explicit promote request auto-qualifies the new record.
    expect(memory.state).toBe('qualified');
    expect(JSON.parse(promoted.stdout).evidence[0]).toMatchObject({
      kind: 'observation',
      referenceId: expect.stringContaining('obs:'),
    });

    const sourceStillExists = await runCommand(memoryCommand, {
      _: ['detail'],
      id: String(observation.id),
      json: true,
    });
    expect(JSON.parse(sourceStillExists.stdout).documents[0].title).toBe('Release smoke source observation');
  });

  it('supersedes an old long-term procedure through the CLI', async () => {
    const create = async (title: string) => {
      const result = await runCommand(memoryCommand, {
        _: ['long-term', 'add'],
        title,
        text: title + ' for the package release.',
        kind: 'procedural',
        scope: 'project',
        tags: 'release,package',
        json: true,
      });
      return JSON.parse(result.stdout).memory;
    };
    const oldMemory = await create('Old package smoke');
    const replacement = await create('Current package smoke');
    // Both are auto-qualified on add, so supersede can retire the old one.

    const superseded = await runCommand(memoryCommand, {
      _: ['long-term', 'supersede'],
      id: oldMemory.id,
      supersededBy: replacement.id,
      reason: 'The current package smoke replaces the old procedure.',
      json: true,
    });
    expect(superseded.exitCode).toBe(0);
    expect(JSON.parse(superseded.stdout).memory).toMatchObject({
      id: oldMemory.id,
      state: 'superseded',
      supersededBy: replacement.id,
    });

    const listed = await runCommand(memoryCommand, { _: ['long-term', 'list'], json: true });
    expect(JSON.parse(listed.stdout).memories.map((item: { memory: { id: string } }) => item.memory.id)).toEqual([
      replacement.id,
    ]);
  });
});
