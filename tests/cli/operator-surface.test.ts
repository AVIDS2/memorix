import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import sessionCommand from '../../src/cli/commands/session.js';
import teamCommand from '../../src/cli/commands/team.js';
import taskCommand from '../../src/cli/commands/task.js';
import messageCommand from '../../src/cli/commands/message.js';
import lockCommand from '../../src/cli/commands/lock.js';
import pollCommand from '../../src/cli/commands/poll.js';
import memoryCommand from '../../src/cli/commands/memory.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { resetSessionStore } from '../../src/store/session-store.js';
import { resetTeamStore } from '../../src/team/team-store.js';
import { resetMiniSkillStore } from '../../src/store/mini-skill-store.js';
import { resetMiniSkillFreshness } from '../../src/memory/freshness.js';

async function runCommand(command: any, args: Record<string, unknown>) {
  const logs: string[] = [];
  const errors: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...parts) => {
    logs.push(parts.map(String).join(' '));
  });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...parts) => {
    errors.push(parts.map(String).join(' '));
  });
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

describe('CLI operator surface', () => {
  const originalCwd = process.cwd();
  const originalDataDir = process.env.MEMORIX_DATA_DIR;
  const originalEmbedding = process.env.MEMORIX_EMBEDDING;
  let sandboxRoot = '';
  let repoDir = '';
  let dataDir = '';

  beforeEach(() => {
    sandboxRoot = mkdtempSync(path.join(tmpdir(), 'memorix-cli-'));
    repoDir = path.join(sandboxRoot, 'repo');
    dataDir = path.join(sandboxRoot, 'data');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(path.join(repoDir, 'README.md'), '# test\n', 'utf8');
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    process.chdir(repoDir);
    process.env.MEMORIX_DATA_DIR = dataDir;
    process.env.MEMORIX_EMBEDDING = 'off';
  });

  afterEach(() => {
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
    resetMiniSkillStore();
    resetMiniSkillFreshness();
    closeAllDatabases();
    rmSync(sandboxRoot, { recursive: true, force: true });
  });

  it('session start is lightweight by default and only joins the team when requested', async () => {
    const result = await runCommand(sessionCommand, {
      _: ['start'],
      agent: 'codex-main',
      agentType: 'codex',
      instanceId: 'codex-instance',
      json: true,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.agent).toBeNull();
    expect(parsed.session.id).toMatch(/^sess-/);

    const joined = await runCommand(sessionCommand, {
      _: ['start'],
      agent: 'codex-main',
      agentType: 'codex',
      instanceId: 'codex-instance',
      joinTeam: true,
      json: true,
    });
    expect(joined.exitCode).toBe(0);
    const joinedParsed = JSON.parse(joined.stdout);
    expect(joinedParsed.agent.role).toBe('engineer');
    expect(joinedParsed.agent.agentType).toBe('codex');
  });

  it('team status keeps historical agents out of the default collaborator list', async () => {
    const active = JSON.parse((await runCommand(sessionCommand, {
      _: ['start'],
      agent: 'codex-active',
      agentType: 'codex',
      instanceId: 'codex-active-instance',
      joinTeam: true,
      json: true,
    })).stdout);

    const historical = JSON.parse((await runCommand(sessionCommand, {
      _: ['start'],
      agent: 'windsurf-old',
      agentType: 'windsurf',
      instanceId: 'windsurf-old-instance',
      joinTeam: true,
      json: true,
    })).stdout);

    await runCommand(teamCommand, {
      _: ['leave'],
      agentId: historical.agent.agentId,
      json: true,
    });

    const status = await runCommand(teamCommand, { _: ['status'] });
    expect(status.stdout).toContain('Active collaborators:');
    expect(status.stdout).toContain('codex-active');
    expect(status.stdout).not.toContain('windsurf-old');
    expect(status.stdout).toContain('Historical/inactive collaborators: 1');
    expect(status.stdout).toContain('use --all to list');

    const statusAll = await runCommand(teamCommand, { _: ['status'], all: true });
    expect(statusAll.stdout).toContain('All collaborators:');
    expect(statusAll.stdout).toContain('codex-active');
    expect(statusAll.stdout).toContain('windsurf-old');
    expect(statusAll.stdout).toContain('(inactive)');

    const statusJson = JSON.parse((await runCommand(teamCommand, { _: ['status'], json: true })).stdout);
    expect(statusJson.activeCount).toBe(1);
    expect(statusJson.historicalCount).toBe(1);
    expect(statusJson.visibleAgents).toHaveLength(1);
    expect(statusJson.agents).toHaveLength(2);
    expect(statusJson.visibleAgents[0].agent_id).toBe(active.agent.agentId);
  });

  it('enforces task requiredRole and lets the matching role claim successfully', async () => {
    const engineerStart = JSON.parse((await runCommand(sessionCommand, {
      _: ['start'],
      agent: 'codex-main',
      agentType: 'codex',
      instanceId: 'codex-instance',
      joinTeam: true,
      json: true,
    })).stdout);

    const researcherStart = JSON.parse((await runCommand(sessionCommand, {
      _: ['start'],
      agent: 'gemini-main',
      agentType: 'gemini-cli',
      instanceId: 'gemini-instance',
      joinTeam: true,
      json: true,
    })).stdout);

    const taskCreate = JSON.parse((await runCommand(taskCommand, {
      _: ['create'],
      description: 'Research the embedding fallback behavior',
      agentId: engineerStart.agent.agentId,
      requiredRole: 'researcher',
      json: true,
    })).stdout);

    const wrongClaim = await runCommand(taskCommand, {
      _: ['claim'],
      taskId: taskCreate.task.task_id,
      agentId: engineerStart.agent.agentId,
      json: true,
    });
    expect(wrongClaim.exitCode).toBe(1);
    expect(JSON.parse(wrongClaim.stderr).error).toContain('Role mismatch');

    const rightClaim = await runCommand(taskCommand, {
      _: ['claim'],
      taskId: taskCreate.task.task_id,
      agentId: researcherStart.agent.agentId,
      json: true,
    });
    expect(rightClaim.exitCode).toBe(0);
    expect(JSON.parse(rightClaim.stdout).result.success).toBe(true);
  });

  it('sends messages, surfaces inbox state, and exposes locks plus poll output', async () => {
    const engineer = JSON.parse((await runCommand(sessionCommand, {
      _: ['start'],
      agent: 'codex-main',
      agentType: 'codex',
      instanceId: 'codex-instance',
      joinTeam: true,
      json: true,
    })).stdout);

    const reviewer = JSON.parse((await runCommand(sessionCommand, {
      _: ['start'],
      agent: 'reviewer-main',
      agentType: 'claude-code',
      role: 'reviewer',
      instanceId: 'reviewer-instance',
      joinTeam: true,
      json: true,
    })).stdout);

    const send = await runCommand(messageCommand, {
      _: ['send'],
      from: engineer.agent.agentId,
      to: reviewer.agent.agentId,
      type: 'request',
      content: 'Please review the latest task breakdown',
      json: true,
    });
    expect(send.exitCode).toBe(0);

    const inbox = await runCommand(messageCommand, {
      _: ['inbox'],
      agentId: reviewer.agent.agentId,
      json: true,
    });
    const inboxJson = JSON.parse(inbox.stdout);
    expect(inboxJson.unreadCount).toBe(1);
    expect(inboxJson.messages[0].content).toContain('Please review');

    const lock = await runCommand(lockCommand, {
      _: ['lock'],
      file: 'src/cli/index.ts',
      agentId: engineer.agent.agentId,
      json: true,
    });
    expect(lock.exitCode).toBe(0);

    const status = await runCommand(lockCommand, {
      _: ['status'],
      file: 'src/cli/index.ts',
      json: true,
    });
    const statusJson = JSON.parse(status.stdout);
    expect(statusJson.lock.locked_by).toBe(engineer.agent.agentId);

    const poll = await runCommand(pollCommand, {
      agentId: reviewer.agent.agentId,
      json: true,
    });
    const pollJson = JSON.parse(poll.stdout);
    expect(pollJson.poll.inbox.unreadCount).toBe(1);
    expect(pollJson.poll.team.activeAgents.length).toBeGreaterThanOrEqual(2);
  });

  it('stores, details, and resolves observations through the memory namespace', async () => {
    const stored = await runCommand(memoryCommand, {
      _: ['store'],
      text: 'We switched Docker to serve-http as the official control-plane path.',
      title: 'Docker control-plane default',
      entity: 'docker-runtime',
      type: 'decision',
      concepts: 'docker,control-plane',
      json: true,
    });

    const storeJson = JSON.parse(stored.stdout);
    const obsId = storeJson.observation.id;
    expect(obsId).toBeTypeOf('number');

    const detail = await runCommand(memoryCommand, {
      _: ['detail'],
      id: String(obsId),
      json: true,
    });
    const detailJson = JSON.parse(detail.stdout);
    expect(detailJson.documents[0].title).toBe('Docker control-plane default');

    const resolved = await runCommand(memoryCommand, {
      _: ['resolve'],
      id: String(obsId),
      status: 'resolved',
      json: true,
    });
    const resolvedJson = JSON.parse(resolved.stdout);
    expect(resolvedJson.result.resolved).toContain(obsId);
  });
});
