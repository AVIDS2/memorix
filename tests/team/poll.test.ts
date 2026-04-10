/**
 * Team Poll — Phase 4b computeWatermark + computePoll tests.
 *
 * Covers: watermark calculation, full poll snapshot assembly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeWatermark, computePoll } from '../../src/team/poll.js';
import { TeamStore } from '../../src/team/team-store.js';
import { closeDatabase } from '../../src/store/sqlite-db.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memorix-poll-test-'));
}

function cleanup(dir: string): void {
  closeDatabase(dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('computeWatermark', () => {
  it('should return zero watermark when no new observations', () => {
    const wm = computeWatermark(10, 10, 0);
    expect(wm.lastSeenGeneration).toBe(10);
    expect(wm.currentGeneration).toBe(10);
    expect(wm.newObservationCount).toBe(0);
  });

  it('should report new observations when generation advanced', () => {
    const wm = computeWatermark(5, 12, 7);
    expect(wm.lastSeenGeneration).toBe(5);
    expect(wm.currentGeneration).toBe(12);
    expect(wm.newObservationCount).toBe(7);
  });

  it('should handle first session (lastSeen = 0)', () => {
    const wm = computeWatermark(0, 5, 5);
    expect(wm.lastSeenGeneration).toBe(0);
    expect(wm.newObservationCount).toBe(5);
  });
});

describe('computePoll', () => {
  let store: TeamStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    store = new TeamStore();
    await store.init(tmpDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('should return empty poll for project with no activity', () => {
    const wm = computeWatermark(0, 0, 0);
    const poll = computePoll(store, 'proj1', null, wm);

    expect(poll.agent).toBeNull();
    expect(poll.watermark.newObservationCount).toBe(0);
    expect(poll.inbox.unreadCount).toBe(0);
    expect(poll.tasks.myInProgress).toHaveLength(0);
    expect(poll.tasks.availableToClaim).toHaveLength(0);
    expect(poll.team.activeAgents).toHaveLength(0);
    expect(poll.team.totalAgents).toBe(0);
  });

  it('should return agent info when agentId is provided', () => {
    const agent = store.registerAgent({
      projectId: 'proj1',
      agentType: 'windsurf',
      instanceId: 'inst-1',
      name: 'Cascade',
    });

    const wm = computeWatermark(0, 5, 3);
    const poll = computePoll(store, 'proj1', agent.agent_id, wm);

    expect(poll.agent).not.toBeNull();
    expect(poll.agent!.agentId).toBe(agent.agent_id);
    expect(poll.agent!.status).toBe('active');
    expect(poll.watermark.newObservationCount).toBe(3);
    expect(poll.team.activeAgents).toHaveLength(1);
    expect(poll.team.totalAgents).toBe(1);
  });

  it('should show tasks categorized correctly', () => {
    const agent = store.registerAgent({
      projectId: 'proj1',
      agentType: 'test',
      instanceId: 'i1',
    });

    // Create tasks
    const t1 = store.createTask({ projectId: 'proj1', description: 'available task' });
    const t2 = store.createTask({ projectId: 'proj1', description: 'my task' });
    const t3 = store.createTask({ projectId: 'proj1', description: 'done task' });
    const t4 = store.createTask({ projectId: 'proj1', description: 'failed task' });

    // Claim t2
    store.claimTask(t2.task_id, agent.agent_id);
    // Complete t3
    const otherAgent = store.registerAgent({ projectId: 'proj1', agentType: 'other', instanceId: 'i2' });
    store.claimTask(t3.task_id, otherAgent.agent_id);
    store.completeTask(t3.task_id, otherAgent.agent_id, 'done');
    // Fail t4
    store.claimTask(t4.task_id, otherAgent.agent_id);
    store.failTask(t4.task_id, otherAgent.agent_id, 'oops');

    const wm = computeWatermark(0, 0, 0);
    const poll = computePoll(store, 'proj1', agent.agent_id, wm);

    expect(poll.tasks.myInProgress).toHaveLength(1);
    expect(poll.tasks.myInProgress[0].task_id).toBe(t2.task_id);
    expect(poll.tasks.availableToClaim).toHaveLength(1);
    expect(poll.tasks.availableToClaim[0].task_id).toBe(t1.task_id);
    expect(poll.tasks.recentlyCompleted).toHaveLength(1);
    expect(poll.tasks.recentlyFailed).toHaveLength(1);
  });

  it('should show unread messages in inbox', () => {
    const a1 = store.registerAgent({ projectId: 'proj1', agentType: 'a', instanceId: 'i1' });
    const a2 = store.registerAgent({ projectId: 'proj1', agentType: 'b', instanceId: 'i2' });

    store.sendMessage({
      projectId: 'proj1',
      senderAgentId: a2.agent_id,
      recipientAgentId: a1.agent_id,
      type: 'info',
      content: 'hello',
    });

    const wm = computeWatermark(0, 0, 0);
    const poll = computePoll(store, 'proj1', a1.agent_id, wm);

    expect(poll.inbox.unreadCount).toBe(1);
    expect(poll.inbox.messages).toHaveLength(1);
    expect(poll.inbox.messages[0].content).toBe('hello');
  });

  it('should exclude tasks with unmet deps from availableToClaim', () => {
    const dep = store.createTask({ projectId: 'proj1', description: 'dependency' });
    const blocked = store.createTask({ projectId: 'proj1', description: 'blocked', deps: [dep.task_id] });

    const wm = computeWatermark(0, 0, 0);
    const poll = computePoll(store, 'proj1', null, wm);

    // dep is available, blocked is not (unmet dep)
    const availableIds = poll.tasks.availableToClaim.map(t => t.task_id);
    expect(availableIds).toContain(dep.task_id);
    expect(availableIds).not.toContain(blocked.task_id);
  });
});
