import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initTeamStore, resetTeamStore } from '../../src/team/team-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

const PORT_A = 14212;
const PORT_B = 14213;
const BASE_A = `http://127.0.0.1:${PORT_A}`;
const BASE_B = `http://127.0.0.1:${PORT_B}`;

let tempDir: string;
let dataDir: string;

async function getJson(baseUrl: string, urlPath: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${urlPath}`, init);
  return { status: response.status, body: await response.json() };
}

describe('Dashboard coordination truth', () => {
  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-coordination-truth-'));
    dataDir = path.join(tempDir, 'data');
    await fs.mkdir(dataDir, { recursive: true });

    const teamStore = await initTeamStore(dataDir);
    const agentA = teamStore.registerAgent({
      projectId: 'project-a',
      agentType: 'codex',
      instanceId: 'a-1',
      name: 'agent-a',
      role: 'engineer',
    });
    const agentA2 = teamStore.registerAgent({
      projectId: 'project-a',
      agentType: 'windsurf',
      instanceId: 'a-2',
      name: 'agent-a-2',
      role: 'reviewer',
    });
    const agentB = teamStore.registerAgent({
      projectId: 'project-b',
      agentType: 'claude-code',
      instanceId: 'b-1',
      name: 'agent-b',
      role: 'engineer',
    });

    teamStore.createTask({
      projectId: 'project-a',
      description: 'Project A task',
      createdBy: agentA.agent_id,
      requiredRole: 'engineer',
    });
    teamStore.createTask({
      projectId: 'project-b',
      description: 'Project B task',
      createdBy: agentB.agent_id,
      requiredRole: 'engineer',
    });
    teamStore.acquireLock('project-a', 'src/a.ts', agentA.agent_id);
    teamStore.acquireLock('project-b', 'src/b.ts', agentB.agent_id);
    teamStore.sendMessage({
      projectId: 'project-a',
      senderAgentId: agentA.agent_id,
      recipientAgentId: agentA2.agent_id,
      type: 'handoff',
      content: 'Project A handoff',
      toRole: 'reviewer',
      handoffStatus: 'open',
    });

    resetTeamStore();

    const { startDashboard } = await import('../../src/dashboard/server.js');
    const staticDir = path.join(process.cwd(), 'src', 'dashboard', 'static');
    await startDashboard(dataDir, PORT_A, staticDir, 'project-a', 'project-a', false);

    resetTeamStore();
    await startDashboard(dataDir, PORT_B, staticDir, 'project-b', 'project-b', false);
  }, 15_000);

  afterAll(async () => {
    resetTeamStore();
    closeAllDatabases();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('reads agents, tasks, locks, and handoffs from project-scoped SQLite', async () => {
    const { status, body } = await getJson(BASE_A, '/api/team');

    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.readOnly).toBe(true);
    expect(body.mode).toBe('standalone');
    expect(body.agents.map((agent: any) => agent.name).sort()).toEqual(['agent-a', 'agent-a-2']);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].description).toBe('Project A task');
    expect(body.locks).toHaveLength(1);
    expect(body.locks[0].file).toBe('src/a.ts');
    expect(body.handoffs).toHaveLength(1);
    expect(body.handoffs[0].content).toBe('Project A handoff');
    expect(body.totalUnread).toBe(1);
  });

  it('keeps SQLite data visible after the TeamStore singleton is reopened', async () => {
    resetTeamStore();
    closeAllDatabases();

    const { status, body } = await getJson(BASE_A, '/api/team');

    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.tasks[0].description).toBe('Project A task');
    expect(body.locks[0].file).toBe('src/a.ts');
  });

  it('reports SQLite read failures without leaking local details', async () => {
    const teamStore = await initTeamStore(dataDir);
    const originalListAgents = teamStore.listAgents;
    teamStore.listAgents = (() => {
      throw new Error(`simulated failure at ${dataDir}`);
    }) as typeof teamStore.listAgents;
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { status, body } = await getJson(BASE_A, '/api/team');

      expect(status).toBe(503);
      expect(body.status).toBe('error');
      expect(body.errorCode).toBe('COORDINATION_STATE_UNAVAILABLE');
      expect(body.error).toBe('Coordination state unavailable');
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain(dataDir);
    } finally {
      teamStore.listAgents = originalListAgents;
      logSpy.mockRestore();
    }
  });

  it('isolates project A and project B coordination snapshots', async () => {
    const projectA = await getJson(BASE_A, '/api/team');
    const projectB = await getJson(BASE_B, '/api/team');

    expect(projectA.body.tasks.map((task: any) => task.description)).toEqual(['Project A task']);
    expect(projectA.body.locks.map((lock: any) => lock.file)).toEqual(['src/a.ts']);
    expect(projectB.body.tasks.map((task: any) => task.description)).toEqual(['Project B task']);
    expect(projectB.body.locks.map((lock: any) => lock.file)).toEqual(['src/b.ts']);
    expect(projectB.body.handoffs).toEqual([]);
  });

  it('does not expose successful team or task write paths', async () => {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      for (const urlPath of ['/api/team', '/api/team/task', '/api/task']) {
        const { status } = await getJson(BASE_A, urlPath, { method });
        expect(status, `${method} ${urlPath}`).toBeGreaterThanOrEqual(400);
      }
    }
  });

  it('keeps the dashboard coordination surface read-only and accurately named', async () => {
    const app = await fs.readFile(path.join(process.cwd(), 'src', 'dashboard', 'static', 'app.js'), 'utf8');
    const server = await fs.readFile(path.join(process.cwd(), 'src', 'dashboard', 'server.ts'), 'utf8');
    const packageJson = JSON.parse(await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8'));
    const packageLock = JSON.parse(await fs.readFile(path.join(process.cwd(), 'package-lock.json'), 'utf8'));
    const serverManifest = JSON.parse(await fs.readFile(path.join(process.cwd(), 'server.json'), 'utf8'));

    expect(packageJson.version).toBe('1.8.5');
    expect(packageLock.version).toBe('1.8.5');
    expect(packageLock.packages[''].version).toBe('1.8.5');
    expect(serverManifest.version).toBe('1.8.5');
    expect(app).toContain("teamTaskStatus: 'Task Status'");
    expect(app).toContain("teamTaskStatus: '任务状态'");
    expect(app).toContain("teamTitle: 'Coordination Status'");
    expect(app).toContain("teamTitle: '协作状态'");
    expect(app).toContain("modeControlPlane: 'Control Plane'");
    expect(app).toContain("dashboardMode === 'control-plane'");
    expect(app).not.toContain(['Task', 'Board'].join(' '));
    expect(app).not.toContain(['任务', '看板'].join(''));
    const legacyInstanceTypes = [['Team', 'Instances'], ['team', 'Instances']].map(parts => parts.join(''));
    for (const legacyInstanceType of legacyInstanceTypes) {
      expect(server).not.toContain(legacyInstanceType);
    }
  });
});
