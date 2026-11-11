import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import identityCommand from '../../src/cli/commands/identity.js';
import memoryCommand from '../../src/cli/commands/memory.js';
import sessionCommand from '../../src/cli/commands/session.js';
import taskCommand from '../../src/cli/commands/task.js';
import { getRecentMemories, searchMemories } from '../../src/cli/tui/data.js';
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

describe('CLI identity control plane', () => {
  const originalCwd = process.cwd();
  const originalDataDir = process.env.MEMORIX_DATA_DIR;
  const originalEmbedding = process.env.MEMORIX_EMBEDDING;
  const originalProjectRoot = process.env.MEMORIX_CLI_PROJECT_ROOT;
  const originalActorId = process.env.MEMORIX_CLI_ACTOR_ID;
  let sandboxRoot = '';
  let repoDir = '';
  let dataDir = '';

  beforeEach(() => {
    sandboxRoot = mkdtempSync(path.join(tmpdir(), 'memorix-cli-identity-'));
    repoDir = path.join(sandboxRoot, 'repo');
    dataDir = path.join(sandboxRoot, 'data');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(path.join(repoDir, 'README.md'), '# identity test\n', 'utf8');
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    process.chdir(repoDir);
    process.env.MEMORIX_DATA_DIR = dataDir;
    process.env.MEMORIX_EMBEDDING = 'off';
    delete process.env.MEMORIX_CLI_PROJECT_ROOT;
    delete process.env.MEMORIX_CLI_ACTOR_ID;
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalDataDir === undefined) delete process.env.MEMORIX_DATA_DIR;
    else process.env.MEMORIX_DATA_DIR = originalDataDir;
    if (originalEmbedding === undefined) delete process.env.MEMORIX_EMBEDDING;
    else process.env.MEMORIX_EMBEDDING = originalEmbedding;
    if (originalProjectRoot === undefined) delete process.env.MEMORIX_CLI_PROJECT_ROOT;
    else process.env.MEMORIX_CLI_PROJECT_ROOT = originalProjectRoot;
    if (originalActorId === undefined) delete process.env.MEMORIX_CLI_ACTOR_ID;
    else process.env.MEMORIX_CLI_ACTOR_ID = originalActorId;
    resetObservationStore();
    resetSessionStore();
    resetTeamStore();
    await resetDb();
    closeAllDatabases();
    rmSync(sandboxRoot, { recursive: true, force: true });
  });

  it('keeps a plain CLI project-scoped, then restores private memory and coordination ergonomics after identity activation', async () => {
    const denied = await runCommand(memoryCommand, {
      _: ['store'],
      text: 'Private deployment credential rotation notes.',
      title: 'Private deployment note',
      visibility: 'personal',
      json: true,
    });
    expect(denied.exitCode).toBe(1);
    expect(JSON.parse(denied.stderr).error).toContain('requires an active CLI identity');

    const joined = await runCommand(identityCommand, {
      _: ['join'],
      agentType: 'codex',
      instanceId: 'identity-test-terminal',
      name: 'Codex test terminal',
      json: true,
    });
    expect(joined.exitCode).toBe(0);
    const agent = JSON.parse(joined.stdout).agent;

    const stored = await runCommand(memoryCommand, {
      _: ['store'],
      text: 'Private deployment credential rotation notes.',
      title: 'Private deployment note',
      visibility: 'personal',
      json: true,
    });
    expect(stored.exitCode).toBe(0);
    const privateObservation = JSON.parse(stored.stdout).observation;
    expect(privateObservation).toMatchObject({
      visibility: 'personal',
      createdByAgentId: agent.agent_id,
    });
    expect(await searchMemories('credential rotation')).toHaveLength(1);
    expect((await getRecentMemories()).map((entry) => entry.id)).toContain(privateObservation.id);

    const unsafePromotion = await runCommand(memoryCommand, {
      _: ['promote'],
      ids: String(privateObservation.id),
      json: true,
    });
    expect(unsafePromotion.exitCode).toBe(1);
    expect(JSON.parse(unsafePromotion.stderr).error).toContain('cannot be promoted into shared skills');

    const task = await runCommand(taskCommand, {
      _: ['create'],
      description: 'Verify the identity-aware task command',
      json: true,
    });
    expect(task.exitCode).toBe(0);
    expect(JSON.parse(task.stdout).task.created_by).toBe(agent.agent_id);

    const cleared = await runCommand(identityCommand, { _: ['clear'], json: true });
    expect(cleared.exitCode).toBe(0);

    const hidden = await runCommand(memoryCommand, {
      _: ['search'],
      query: 'credential rotation',
      json: true,
    });
    expect(hidden.exitCode).toBe(0);
    expect(JSON.parse(hidden.stdout).entries).toHaveLength(0);
    expect(await searchMemories('credential rotation')).toHaveLength(0);

    const restored = await runCommand(identityCommand, {
      _: ['use'],
      agentId: agent.agent_id,
      json: true,
    });
    expect(restored.exitCode).toBe(0);

    const visible = await runCommand(memoryCommand, {
      _: ['search'],
      query: 'credential rotation',
      json: true,
    });
    expect(visible.exitCode).toBe(0);
    expect(JSON.parse(visible.stdout).entries).toHaveLength(1);
  });

  it('activates a persistent identity through an explicit coordination session and rejects incomplete activation', async () => {
    const incomplete = await runCommand(sessionCommand, {
      _: ['start'],
      joinTeam: true,
      use: true,
      json: true,
    });
    expect(incomplete.exitCode).toBe(1);
    expect(JSON.parse(incomplete.stderr).error).toContain('requires --agent or --agentType');

    const started = await runCommand(sessionCommand, {
      _: ['start'],
      agent: 'Codex release terminal',
      agentType: 'codex',
      instanceId: 'release-terminal',
      joinTeam: true,
      use: true,
      json: true,
    });
    expect(started.exitCode).toBe(0);
    const startPayload = JSON.parse(started.stdout);
    expect(startPayload.identityActivated).toBe(true);
    expect(startPayload.agent.agentId).toBeTruthy();

    const status = await runCommand(identityCommand, { _: ['status'], json: true });
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout).identity.agentId).toBe(startPayload.agent.agentId);
  });

  it('does not inject a prior CLI identity personal memory when a new coordination session starts', async () => {
    const shared = await runCommand(memoryCommand, {
      _: ['store'],
      text: 'The shared release checklist requires a package smoke test.',
      title: 'Project release checklist',
      json: true,
    });
    expect(shared.exitCode).toBe(0);

    const owner = await runCommand(identityCommand, {
      _: ['join'],
      agentType: 'codex',
      instanceId: 'private-owner-terminal',
      name: 'Private owner terminal',
      json: true,
    });
    expect(owner.exitCode).toBe(0);

    const privateMemory = await runCommand(memoryCommand, {
      _: ['store'],
      text: 'Only the owner should see this migration credential checklist.',
      title: 'Owner-only session memory',
      visibility: 'personal',
      json: true,
    });
    expect(privateMemory.exitCode).toBe(0);

    const cleared = await runCommand(identityCommand, { _: ['clear'], json: true });
    expect(cleared.exitCode).toBe(0);

    const foreignSession = await runCommand(sessionCommand, {
      _: ['start'],
      agent: 'Foreign release terminal',
      agentType: 'claude-code',
      instanceId: 'foreign-release-terminal',
      joinTeam: true,
      use: true,
      json: true,
    });
    expect(foreignSession.exitCode).toBe(0);
    const payload = JSON.parse(foreignSession.stdout);
    expect(payload.previousContext).toContain('Project release checklist');
    expect(payload.previousContext).not.toContain('Owner-only session memory');
  });
});
