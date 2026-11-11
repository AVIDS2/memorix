/**
 * TaskLifecycleHook — Phase 4b lifecycle event emission tests.
 *
 * Covers: events fire on task/agent state changes, events fire AFTER successful writes,
 * listener errors do not affect TeamStore writes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TeamStore } from '../../src/team/team-store.js';
import { TeamEventBus } from '../../src/team/event-bus.js';
import { closeDatabase } from '../../src/store/sqlite-db.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memorix-lifecycle-test-'));
}

function cleanup(dir: string): void {
  closeDatabase(dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('TaskLifecycleHook', () => {
  let store: TeamStore;
  let bus: TeamEventBus;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    store = new TeamStore();
    await store.init(tmpDir);
    bus = new TeamEventBus();
    store.setEventBus(bus);
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // ── Task lifecycle events ──────────────────────────────────────

  it('should emit task:created when a task is created', () => {
    const received: any[] = [];
    bus.on('task:created', (data) => received.push(data));

    const task = store.createTask({ projectId: 'proj1', description: 'do something' });

    expect(received).toHaveLength(1);
    expect(received[0].taskId).toBe(task.task_id);
    expect(received[0].projectId).toBe('proj1');
    expect(received[0].description).toBe('do something');
  });

  it('should emit task:claimed when a task is claimed', () => {
    const received: any[] = [];
    bus.on('task:claimed', (data) => received.push(data));

    const agent = store.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });
    const task = store.createTask({ projectId: 'proj1', description: 'claimable' });
    store.claimTask(task.task_id, agent.agent_id);

    expect(received).toHaveLength(1);
    expect(received[0].taskId).toBe(task.task_id);
    expect(received[0].agentId).toBe(agent.agent_id);
  });

  it('should NOT emit task:claimed when claim fails', () => {
    const received: any[] = [];
    bus.on('task:claimed', (data) => received.push(data));

    const a1 = store.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });
    const a2 = store.registerAgent({ projectId: 'proj1', agentType: 'test2', instanceId: 'i2' });
    const task = store.createTask({ projectId: 'proj1', description: 'contested' });

    store.claimTask(task.task_id, a1.agent_id); // succeeds
    store.claimTask(task.task_id, a2.agent_id); // fails — already claimed

    expect(received).toHaveLength(1); // only the successful claim
    expect(received[0].agentId).toBe(a1.agent_id);
  });

  it('should emit task:completed on successful completion', () => {
    const received: any[] = [];
    bus.on('task:completed', (data) => received.push(data));

    const agent = store.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });
    const task = store.createTask({ projectId: 'proj1', description: 'completable' });
    store.claimTask(task.task_id, agent.agent_id);
    store.completeTask(task.task_id, agent.agent_id, 'done!');

    expect(received).toHaveLength(1);
    expect(received[0].taskId).toBe(task.task_id);
    expect(received[0].result).toBe('done!');
  });

  it('should emit task:failed on task failure', () => {
    const received: any[] = [];
    bus.on('task:failed', (data) => received.push(data));

    const agent = store.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });
    const task = store.createTask({ projectId: 'proj1', description: 'will fail' });
    store.claimTask(task.task_id, agent.agent_id);
    store.failTask(task.task_id, agent.agent_id, 'error occurred');

    expect(received).toHaveLength(1);
    expect(received[0].taskId).toBe(task.task_id);
    expect(received[0].result).toBe('error occurred');
  });

  it('should emit task:released when a task is released', () => {
    const received: any[] = [];
    bus.on('task:released', (data) => received.push(data));

    const agent = store.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });
    const task = store.createTask({ projectId: 'proj1', description: 'releasable' });
    store.claimTask(task.task_id, agent.agent_id);
    store.releaseTask(task.task_id, agent.agent_id);

    expect(received).toHaveLength(1);
    expect(received[0].taskId).toBe(task.task_id);
    expect(received[0].agentId).toBe(agent.agent_id);
  });

  // ── Agent lifecycle events ─────────────────────────────────────

  it('should emit agent:joined when an agent registers', () => {
    const received: any[] = [];
    bus.on('agent:joined', (data) => received.push(data));

    const agent = store.registerAgent({
      projectId: 'proj1',
      agentType: 'windsurf',
      instanceId: 'inst-1',
      name: 'Cascade',
    });

    expect(received).toHaveLength(1);
    expect(received[0].agentId).toBe(agent.agent_id);
    expect(received[0].agentType).toBe('windsurf');
  });

  it('should emit agent:joined on reactivation', () => {
    const received: any[] = [];
    bus.on('agent:joined', (data) => received.push(data));

    store.registerAgent({ projectId: 'proj1', agentType: 'windsurf', instanceId: 'inst-1' });
    store.registerAgent({ projectId: 'proj1', agentType: 'windsurf', instanceId: 'inst-1' }); // reactivate

    expect(received).toHaveLength(2); // joined twice
  });

  it('should emit agent:left when an agent leaves', () => {
    const received: any[] = [];
    bus.on('agent:left', (data) => received.push(data));

    const agent = store.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });
    store.leaveAgent(agent.agent_id);

    expect(received).toHaveLength(1);
    expect(received[0].agentId).toBe(agent.agent_id);
    expect(received[0].projectId).toBe('proj1');
  });

  it('should emit agent:stale when stale agent is detected', () => {
    const received: any[] = [];
    bus.on('agent:stale', (data) => received.push(data));

    const agent = store.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });
    // Make the heartbeat very old
    store.getDb().prepare('UPDATE team_agents SET last_heartbeat = ? WHERE agent_id = ?')
      .run(Date.now() - 10 * 60 * 1000, agent.agent_id); // 10 min ago

    store.detectAndMarkStale('proj1', 5 * 60 * 1000); // 5 min TTL

    expect(received).toHaveLength(1);
    expect(received[0].agentId).toBe(agent.agent_id);
    expect(received[0].projectId).toBe('proj1');
  });

  // ── Error isolation (Codex constraint #3) ──────────────────────

  it('should NOT prevent TeamStore writes when listener throws', () => {
    bus.on('task:created', () => { throw new Error('listener crash'); });

    // createTask should succeed despite listener error
    const task = store.createTask({ projectId: 'proj1', description: 'survives crash' });
    expect(task.task_id).toBeTruthy();

    // Verify task is actually in the database
    const retrieved = store.getTask(task.task_id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.description).toBe('survives crash');
  });

  it('should NOT prevent claim when listener throws', () => {
    bus.on('task:claimed', () => { throw new Error('listener crash'); });

    const agent = store.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });
    const task = store.createTask({ projectId: 'proj1', description: 'claim test' });

    const result = store.claimTask(task.task_id, agent.agent_id);
    expect(result.success).toBe(true);

    const retrieved = store.getTask(task.task_id);
    expect(retrieved!.status).toBe('in_progress');
    expect(retrieved!.assignee_agent_id).toBe(agent.agent_id);
  });

  it('should NOT prevent completion when listener throws', () => {
    bus.on('task:completed', () => { throw new Error('listener crash'); });

    const agent = store.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });
    const task = store.createTask({ projectId: 'proj1', description: 'complete test' });
    store.claimTask(task.task_id, agent.agent_id);

    const result = store.completeTask(task.task_id, agent.agent_id, 'done');
    expect(result.success).toBe(true);

    const retrieved = store.getTask(task.task_id);
    expect(retrieved!.status).toBe('completed');
  });

  // ── No EventBus (graceful degradation) ────────────────────────

  it('should work normally without an EventBus', async () => {
    // Create a fresh store without EventBus
    const tmpDir2 = makeTmpDir();
    const store2 = new TeamStore();
    await store2.init(tmpDir2);
    // No setEventBus call

    const agent = store2.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });
    const task = store2.createTask({ projectId: 'proj1', description: 'no bus test' });
    const claim = store2.claimTask(task.task_id, agent.agent_id);
    expect(claim.success).toBe(true);

    store2.completeTask(task.task_id, agent.agent_id, 'done');
    const retrieved = store2.getTask(task.task_id);
    expect(retrieved!.status).toBe('completed');

    cleanup(tmpDir2);
  });
});
