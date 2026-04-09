/**
 * TeamStore — SQLite-backed team collaboration store tests.
 *
 * Covers: agent registration, messages, atomic task claims, locks,
 * cross-process safety, and team-state.json migration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TeamStore } from '../../src/team/team-store.js';
import { closeDatabase } from '../../src/store/sqlite-db.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memorix-team-test-'));
}

function cleanup(dir: string): void {
  closeDatabase(dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('TeamStore', () => {
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

  // ═════════════════════════════════════════════════════════════════
  // Agent Registration
  // ═════════════════════════════════════════════════════════════════

  describe('Agent Registration', () => {
    it('should register a new agent and return stable agent_id', async () => {
      const agent = store.registerAgent({
        projectId: 'proj1',
        agentType: 'windsurf',
        instanceId: 'inst-1',
        name: 'Cascade',
      });
      expect(agent.agent_id).toBeTruthy();
      expect(agent.agent_type).toBe('windsurf');
      expect(agent.instance_id).toBe('inst-1');
      expect(agent.name).toBe('Cascade');
      expect(agent.status).toBe('active');
    });

    it('should reactivate existing agent by (project_id, agent_type, instance_id)', async () => {
      const first = store.registerAgent({
        projectId: 'proj1',
        agentType: 'windsurf',
        instanceId: 'inst-1',
        name: 'Cascade',
      });
      // Simulate leave
      store.leaveAgent(first.agent_id);

      const second = store.registerAgent({
        projectId: 'proj1',
        agentType: 'windsurf',
        instanceId: 'inst-1',
        name: 'Cascade v2', // name can change
      });

      expect(second.agent_id).toBe(first.agent_id); // same durable identity
      expect(second.name).toBe('Cascade v2');
      expect(second.status).toBe('active');
    });

    it('should NOT merge two agents with same type+name but different instance_id', async () => {
      const a = store.registerAgent({
        projectId: 'proj1',
        agentType: 'windsurf',
        instanceId: 'window-1',
        name: 'Cascade',
      });
      const b = store.registerAgent({
        projectId: 'proj1',
        agentType: 'windsurf',
        instanceId: 'window-2',
        name: 'Cascade', // same name!
      });

      expect(a.agent_id).not.toBe(b.agent_id); // distinct identities
      expect(store.getActiveCount('proj1')).toBe(2);
    });

    it('should auto-generate instance_id when not provided', async () => {
      const agent = store.registerAgent({
        projectId: 'proj1',
        agentType: 'cursor',
      });
      expect(agent.instance_id).toBeTruthy();
      expect(agent.instance_id.length).toBeGreaterThan(10); // UUID
    });

    it('should list agents filtered by status', async () => {
      const a = store.registerAgent({ projectId: 'proj1', agentType: 'windsurf', instanceId: 'i1' });
      store.registerAgent({ projectId: 'proj1', agentType: 'cursor', instanceId: 'i2' });
      store.leaveAgent(a.agent_id);

      const active = store.listAgents('proj1', { status: 'active' });
      const inactive = store.listAgents('proj1', { status: 'inactive' });
      expect(active.length).toBe(1);
      expect(inactive.length).toBe(1);
      expect(inactive[0].agent_id).toBe(a.agent_id);
    });

    it('should update heartbeat', async () => {
      const agent = store.registerAgent({ projectId: 'proj1', agentType: 'windsurf', instanceId: 'i1' });
      const before = store.getAgent(agent.agent_id)!.last_heartbeat;

      // Small delay to ensure different timestamp
      await new Promise(r => setTimeout(r, 15));
      store.heartbeat(agent.agent_id);

      const after = store.getAgent(agent.agent_id)!.last_heartbeat;
      expect(after).toBeGreaterThanOrEqual(before);
    });

    it('should detect and mark stale agents', async () => {
      const agent = store.registerAgent({ projectId: 'proj1', agentType: 'windsurf', instanceId: 'i1' });
      // Force old heartbeat
      store.getDb().prepare('UPDATE team_agents SET last_heartbeat = ? WHERE agent_id = ?')
        .run(Date.now() - 60000, agent.agent_id);

      const stale = store.detectAndMarkStale('proj1', 30000); // 30s threshold
      expect(stale).toContain(agent.agent_id);

      const updated = store.getAgent(agent.agent_id)!;
      expect(updated.status).toBe('inactive');
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // Messages
  // ═════════════════════════════════════════════════════════════════

  describe('Messages', () => {
    let agentA: string;
    let agentB: string;

    beforeEach(() => {
      agentA = store.registerAgent({ projectId: 'proj1', agentType: 'windsurf', instanceId: 'a' }).agent_id;
      agentB = store.registerAgent({ projectId: 'proj1', agentType: 'cursor', instanceId: 'b' }).agent_id;
    });

    it('should send direct message and appear in recipient inbox', () => {
      store.sendMessage({
        projectId: 'proj1',
        senderAgentId: agentA,
        recipientAgentId: agentB,
        type: 'direct',
        content: 'Hello B',
      });

      const inbox = store.getInbox('proj1', agentB);
      expect(inbox.length).toBe(1);
      expect(inbox[0].content).toBe('Hello B');
      expect(inbox[0].sender_agent_id).toBe(agentA);
    });

    it('should deliver broadcast messages to all agents', () => {
      store.sendMessage({
        projectId: 'proj1',
        senderAgentId: agentA,
        recipientAgentId: null,
        type: 'broadcast',
        content: 'Hello everyone',
      });

      const inboxA = store.getInbox('proj1', agentA);
      const inboxB = store.getInbox('proj1', agentB);
      // Broadcast is visible to both (including sender)
      expect(inboxA.length).toBe(1);
      expect(inboxB.length).toBe(1);
    });

    it('should accept messages to inactive recipients (durable messaging)', () => {
      store.leaveAgent(agentB);

      // This must NOT throw — key fix for F6
      const msg = store.sendMessage({
        projectId: 'proj1',
        senderAgentId: agentA,
        recipientAgentId: agentB,
        type: 'handoff',
        content: 'Handoff context',
        payload: { summary: 'Done task X', nextSteps: ['Continue Y'] },
      });
      expect(msg.id).toBeTruthy();

      // When B comes back, it can read the message
      const inbox = store.getInbox('proj1', agentB);
      expect(inbox.length).toBe(1);
      expect(inbox[0].type).toBe('handoff');
    });

    it('should track read status', () => {
      store.sendMessage({
        projectId: 'proj1',
        senderAgentId: agentA,
        recipientAgentId: agentB,
        type: 'direct',
        content: 'Read me',
      });

      expect(store.getUnreadCount('proj1', agentB)).toBe(1);

      const inbox = store.getInbox('proj1', agentB);
      store.markMessageRead(inbox[0].id);

      expect(store.getUnreadCount('proj1', agentB)).toBe(0);
    });

    it('should prune read messages', async () => {
      const msg = store.sendMessage({
        projectId: 'proj1',
        senderAgentId: agentA,
        recipientAgentId: agentB,
        type: 'direct',
        content: 'Old message',
      });

      store.markMessageRead(msg.id);

      // Small delay so read_at is strictly in the past
      await new Promise(r => setTimeout(r, 15));

      // Prune messages read more than 0ms ago
      const pruned = store.pruneReadMessages('proj1', 0);
      expect(pruned).toBe(1);
      expect(store.getInbox('proj1', agentB).length).toBe(0);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // Tasks — Atomic Claim Semantics
  // ═════════════════════════════════════════════════════════════════

  describe('Tasks', () => {
    let agentA: string;
    let agentB: string;

    beforeEach(() => {
      agentA = store.registerAgent({ projectId: 'proj1', agentType: 'windsurf', instanceId: 'a' }).agent_id;
      agentB = store.registerAgent({ projectId: 'proj1', agentType: 'cursor', instanceId: 'b' }).agent_id;
    });

    it('should create and claim a task', () => {
      const task = store.createTask({ projectId: 'proj1', description: 'Fix bug' });
      const result = store.claimTask(task.task_id, agentA);
      expect(result.success).toBe(true);
      expect(result.task?.assignee_agent_id).toBe(agentA);
      expect(result.task?.status).toBe('in_progress');
    });

    it('should reject claim when task already claimed by another agent', () => {
      const task = store.createTask({ projectId: 'proj1', description: 'Fix bug' });
      store.claimTask(task.task_id, agentA);
      const result = store.claimTask(task.task_id, agentB);
      expect(result.success).toBe(false);
      expect(result.reason).toContain('already claimed');
    });

    it('should allow same agent to re-claim (idempotent)', () => {
      const task = store.createTask({ projectId: 'proj1', description: 'Fix bug' });
      store.claimTask(task.task_id, agentA);
      const result = store.claimTask(task.task_id, agentA);
      expect(result.success).toBe(true);
    });

    it('should reject claim when dependencies are unmet', () => {
      const dep = store.createTask({ projectId: 'proj1', description: 'Dep task' });
      const task = store.createTask({ projectId: 'proj1', description: 'Main task', deps: [dep.task_id] });

      const result = store.claimTask(task.task_id, agentA);
      expect(result.success).toBe(false);
      expect(result.reason).toContain('unmet');
    });

    it('should allow claim after dependencies are completed', () => {
      const dep = store.createTask({ projectId: 'proj1', description: 'Dep task' });
      const task = store.createTask({ projectId: 'proj1', description: 'Main task', deps: [dep.task_id] });

      store.claimTask(dep.task_id, agentA);
      store.completeTask(dep.task_id, agentA, 'Done');

      const result = store.claimTask(task.task_id, agentB);
      expect(result.success).toBe(true);
    });

    it('should complete task atomically', () => {
      const task = store.createTask({ projectId: 'proj1', description: 'Fix bug' });
      store.claimTask(task.task_id, agentA);

      const result = store.completeTask(task.task_id, agentA, 'Fixed');
      expect(result.success).toBe(true);

      const updated = store.getTask(task.task_id)!;
      expect(updated.status).toBe('completed');
      expect(updated.result).toBe('Fixed');
    });

    it('should reject complete by non-assignee', () => {
      const task = store.createTask({ projectId: 'proj1', description: 'Fix bug' });
      store.claimTask(task.task_id, agentA);

      const result = store.completeTask(task.task_id, agentB, 'I did it');
      expect(result.success).toBe(false);
    });

    it('should release task and make it available again', () => {
      const task = store.createTask({ projectId: 'proj1', description: 'Fix bug' });
      store.claimTask(task.task_id, agentA);
      store.releaseTask(task.task_id, agentA);

      const updated = store.getTask(task.task_id)!;
      expect(updated.status).toBe('pending');
      expect(updated.assignee_agent_id).toBeNull();

      // Another agent can now claim it
      const result = store.claimTask(task.task_id, agentB);
      expect(result.success).toBe(true);
    });

    it('should release all tasks on agent stale rescue', () => {
      const t1 = store.createTask({ projectId: 'proj1', description: 'Task 1' });
      const t2 = store.createTask({ projectId: 'proj1', description: 'Task 2' });
      store.claimTask(t1.task_id, agentA);
      store.claimTask(t2.task_id, agentA);

      const released = store.releaseTasksByAgent(agentA);
      expect(released).toBe(2);

      expect(store.getTask(t1.task_id)!.status).toBe('pending');
      expect(store.getTask(t2.task_id)!.status).toBe('pending');
    });

    it('should list available tasks', () => {
      store.createTask({ projectId: 'proj1', description: 'Available' });
      const claimed = store.createTask({ projectId: 'proj1', description: 'Claimed' });
      store.claimTask(claimed.task_id, agentA);

      const available = store.listTasks('proj1', { available: true });
      expect(available.length).toBe(1);
      expect(available[0].description).toBe('Available');
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // Locks
  // ═════════════════════════════════════════════════════════════════

  describe('Locks', () => {
    let agentA: string;
    let agentB: string;

    beforeEach(() => {
      agentA = store.registerAgent({ projectId: 'proj1', agentType: 'windsurf', instanceId: 'a' }).agent_id;
      agentB = store.registerAgent({ projectId: 'proj1', agentType: 'cursor', instanceId: 'b' }).agent_id;
    });

    it('should acquire and release a lock', () => {
      const result = store.acquireLock('proj1', 'src/main.ts', agentA);
      expect(result.success).toBe(true);

      const released = store.releaseLock('proj1', 'src/main.ts', agentA);
      expect(released).toBe(true);
    });

    it('should reject lock by different agent', () => {
      store.acquireLock('proj1', 'src/main.ts', agentA);
      const result = store.acquireLock('proj1', 'src/main.ts', agentB);
      expect(result.success).toBe(false);
      expect(result.lockedBy).toBe(agentA);
    });

    it('should allow same agent to re-lock (TTL refresh)', () => {
      store.acquireLock('proj1', 'src/main.ts', agentA);
      const result = store.acquireLock('proj1', 'src/main.ts', agentA);
      expect(result.success).toBe(true);
    });

    it('should auto-expire locks', () => {
      store.acquireLock('proj1', 'src/main.ts', agentA, 1); // 1ms TTL

      // Wait for expiry
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }

      // After expiry, another agent can lock
      const result = store.acquireLock('proj1', 'src/main.ts', agentB);
      expect(result.success).toBe(true);
    });

    it('should release all locks by agent', () => {
      store.acquireLock('proj1', 'src/a.ts', agentA);
      store.acquireLock('proj1', 'src/b.ts', agentA);

      const released = store.releaseAllLocks(agentA);
      expect(released).toBe(2);
      expect(store.listLocks('proj1').length).toBe(0);
    });

    it('should not release locks owned by other agents', () => {
      store.acquireLock('proj1', 'src/main.ts', agentA);
      const released = store.releaseLock('proj1', 'src/main.ts', agentB);
      expect(released).toBe(false);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // Cross-Process Safety (simulated with two DB handles)
  // ═════════════════════════════════════════════════════════════════

  describe('Cross-Process Safety', () => {
    it('should handle concurrent task claims — only one succeeds', async () => {
      // Create task via store 1
      const task = store.createTask({ projectId: 'proj1', description: 'Race task' });
      const agentA = store.registerAgent({ projectId: 'proj1', agentType: 'windsurf', instanceId: 'a' }).agent_id;
      const agentB = store.registerAgent({ projectId: 'proj1', agentType: 'cursor', instanceId: 'b' }).agent_id;

      // Create a second store pointing to the same DB
      const store2 = new TeamStore();
      await store2.init(tmpDir);

      // Both try to claim simultaneously
      const resultA = store.claimTask(task.task_id, agentA);
      const resultB = store2.claimTask(task.task_id, agentB);

      // Exactly one should succeed
      const successes = [resultA, resultB].filter(r => r.success);
      expect(successes.length).toBe(1);

      // The task should be assigned to exactly one agent
      const final = store.getTask(task.task_id)!;
      expect(final.status).toBe('in_progress');
      expect([agentA, agentB]).toContain(final.assignee_agent_id);
    });

    it('should see messages written by another process', async () => {
      const agentA = store.registerAgent({ projectId: 'proj1', agentType: 'windsurf', instanceId: 'a' }).agent_id;
      const agentB = store.registerAgent({ projectId: 'proj1', agentType: 'cursor', instanceId: 'b' }).agent_id;

      // Send message via store 1
      store.sendMessage({
        projectId: 'proj1',
        senderAgentId: agentA,
        recipientAgentId: agentB,
        type: 'direct',
        content: 'Cross-process message',
      });

      // Read via store 2
      const store2 = new TeamStore();
      await store2.init(tmpDir);
      const inbox = store2.getInbox('proj1', agentB);
      expect(inbox.length).toBe(1);
      expect(inbox[0].content).toBe('Cross-process message');
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // Migration from team-state.json
  // ═════════════════════════════════════════════════════════════════

  describe('Migration', () => {
    it('should migrate team-state.json to SQLite', async () => {
      const migDir = makeTmpDir();
      try {
        // Write a team-state.json
        const jsonState = {
          version: 1,
          updatedAt: new Date().toISOString(),
          registry: {
            agents: {
              'agent-1': {
                id: 'agent-1',
                name: 'Windsurf Agent',
                role: 'developer',
                capabilities: ['code', 'test'],
                status: 'active',
                joinedAt: '2025-01-01T00:00:00.000Z',
                lastSeenAt: '2025-01-01T01:00:00.000Z',
                leftAt: null,
              },
            },
            nameIndex: { 'Windsurf Agent': 'agent-1' },
          },
          messages: {
            inboxes: {
              'agent-1': [
                {
                  id: 'msg-1',
                  from: 'agent-2',
                  to: 'agent-1',
                  type: 'direct',
                  content: 'Hello',
                  timestamp: '2025-01-01T00:30:00.000Z',
                  read: false,
                },
              ],
            },
          },
          tasks: {
            tasks: {
              'task-1': {
                id: 'task-1',
                description: 'Fix the bug',
                status: 'pending',
                deps: [],
                assignee: null,
                result: null,
                metadata: {},
                createdAt: '2025-01-01T00:00:00.000Z',
                updatedAt: '2025-01-01T00:00:00.000Z',
              },
            },
          },
          locks: {
            locks: {
              'src/main.ts': {
                file: 'src/main.ts',
                lockedBy: 'agent-1',
                lockedAt: '2025-01-01T00:00:00.000Z',
                expiresAt: '2099-01-01T00:00:00.000Z',
              },
            },
          },
        };

        fs.writeFileSync(path.join(migDir, 'team-state.json'), JSON.stringify(jsonState, null, 2));

        // Init store — should trigger migration
        const migStore = new TeamStore();
        await migStore.init(migDir);

        // Verify migration
        const agents = migStore.listAgents('migrated');
        expect(agents.length).toBe(1);
        expect(agents[0].name).toBe('Windsurf Agent');

        const tasks = migStore.listTasks('migrated');
        expect(tasks.length).toBe(1);
        expect(tasks[0].description).toBe('Fix the bug');

        const locks = migStore.listLocks('migrated');
        expect(locks.length).toBe(1);

        // JSON file should be renamed
        expect(fs.existsSync(path.join(migDir, 'team-state.json.migrated'))).toBe(true);
        expect(fs.existsSync(path.join(migDir, 'team-state.json'))).toBe(false);
      } finally {
        cleanup(migDir);
      }
    });

    it('should skip migration if team tables already have data', async () => {
      // Store already has data from beforeEach
      store.registerAgent({ projectId: 'proj1', agentType: 'windsurf', instanceId: 'i1' });

      // Write a JSON file that would trigger migration
      fs.writeFileSync(path.join(tmpDir, 'team-state.json'), JSON.stringify({ version: 1, registry: { agents: {} }, messages: { inboxes: {} }, tasks: { tasks: {} }, locks: { locks: {} } }));

      // Re-init — should NOT migrate because table has data
      const store2 = new TeamStore();
      await store2.init(tmpDir);

      // JSON file should still exist (not renamed)
      expect(fs.existsSync(path.join(tmpDir, 'team-state.json'))).toBe(true);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // Watermark
  // ═════════════════════════════════════════════════════════════════

  describe('Watermark', () => {
    it('should update and read agent watermark', () => {
      const agent = store.registerAgent({ projectId: 'proj1', agentType: 'windsurf', instanceId: 'i1' });
      expect(agent.last_seen_obs_generation).toBe(0);

      store.updateWatermark(agent.agent_id, 42);
      const updated = store.getAgent(agent.agent_id)!;
      expect(updated.last_seen_obs_generation).toBe(42);
    });
  });
});
