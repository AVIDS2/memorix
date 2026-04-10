/**
 * Team Handoff — Phase 4b structured context transfer tests.
 *
 * Covers: observation creation, notification message, topicKey dedup, core immunity.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHandoffArtifact } from '../../src/team/handoff.js';
import { TeamStore } from '../../src/team/team-store.js';
import { TeamEventBus } from '../../src/team/event-bus.js';
import { closeDatabase } from '../../src/store/sqlite-db.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memorix-handoff-test-'));
}

function cleanup(dir: string): void {
  closeDatabase(dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Mock storeObservation that captures arguments and returns a fake observation */
function createMockStore() {
  let nextId = 1;
  const calls: any[] = [];
  const fn = async (params: any) => {
    calls.push(params);
    return { observation: { id: nextId++ }, upserted: false };
  };
  return { fn, calls };
}

describe('createHandoffArtifact', () => {
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

  it('should create observation with correct fields', async () => {
    const mock = createMockStore();
    const a1 = store.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });
    const a2 = store.registerAgent({ projectId: 'proj1', agentType: 'test2', instanceId: 'i2' });

    const result = await createHandoffArtifact(
      {
        projectId: 'proj1',
        fromAgentId: a1.agent_id,
        toAgentId: a2.agent_id,
        summary: 'Finished auth module',
        context: 'JWT implemented, need to add refresh tokens',
        filesModified: ['src/auth.ts'],
        concepts: ['authentication', 'jwt'],
      },
      mock.fn,
      store,
    );

    expect(result.observationId).toBe(1);
    expect(result.fromAgentId).toBe(a1.agent_id);
    expect(result.toAgentId).toBe(a2.agent_id);
    expect(result.summary).toBe('Finished auth module');

    // Check storeObservation was called with correct params
    expect(mock.calls).toHaveLength(1);
    const call = mock.calls[0];
    expect(call.entityName).toBe('team-handoff');
    expect(call.type).toBe('what-changed');
    expect(call.title).toContain('[Handoff]');
    expect(call.narrative).toBe('JWT implemented, need to add refresh tokens');
    expect(call.valueCategory).toBe('core'); // immune to archival
    expect(call.sourceDetail).toBe('explicit');
    expect(call.createdByAgentId).toBe(a1.agent_id);
    expect(call.filesModified).toEqual(['src/auth.ts']);
    expect(call.concepts).toContain('handoff');
    expect(call.concepts).toContain('authentication');
  });

  it('should send notification message to recipient', async () => {
    const mock = createMockStore();
    const a1 = store.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });
    const a2 = store.registerAgent({ projectId: 'proj1', agentType: 'test2', instanceId: 'i2' });

    await createHandoffArtifact(
      {
        projectId: 'proj1',
        fromAgentId: a1.agent_id,
        toAgentId: a2.agent_id,
        summary: 'Handoff test',
        context: 'context data',
      },
      mock.fn,
      store,
    );

    // Check inbox for recipient
    const inbox = store.getInbox('proj1', a2.agent_id);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].type).toBe('handoff');
    expect(inbox[0].content).toContain('Handoff: Handoff test');
    expect(inbox[0].sender_agent_id).toBe(a1.agent_id);
  });

  it('should fanout broadcast to each active agent (excluding sender)', async () => {
    const mock = createMockStore();
    const a1 = store.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });
    const a2 = store.registerAgent({ projectId: 'proj1', agentType: 'test2', instanceId: 'i2' });
    const a3 = store.registerAgent({ projectId: 'proj1', agentType: 'test3', instanceId: 'i3' });

    const result = await createHandoffArtifact(
      {
        projectId: 'proj1',
        fromAgentId: a1.agent_id,
        // no toAgentId → broadcast fanout
        summary: 'Available handoff',
        context: 'anyone can pick up',
      },
      mock.fn,
      store,
    );

    expect(result.toAgentId).toBeUndefined();

    // Each non-sender agent gets their own recipient-specific message
    const inbox2 = store.getInbox('proj1', a2.agent_id);
    const inbox3 = store.getInbox('proj1', a3.agent_id);
    expect(inbox2).toHaveLength(1);
    expect(inbox3).toHaveLength(1);
    // Messages are distinct (different IDs, different recipients)
    expect(inbox2[0].recipient_agent_id).toBe(a2.agent_id);
    expect(inbox3[0].recipient_agent_id).toBe(a3.agent_id);
    expect(inbox2[0].id).not.toBe(inbox3[0].id);
    // Sender does not get a message
    const inbox1 = store.getInbox('proj1', a1.agent_id);
    expect(inbox1.filter(m => m.type === 'handoff')).toHaveLength(0);
  });

  it('should set topicKey when taskId is provided', async () => {
    const mock = createMockStore();
    const a1 = store.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });

    await createHandoffArtifact(
      {
        projectId: 'proj1',
        fromAgentId: a1.agent_id,
        taskId: 'task-123',
        summary: 'Task handoff',
        context: 'task context',
      },
      mock.fn,
      store,
    );

    expect(mock.calls[0].topicKey).toBe(`handoff:task-123:${a1.agent_id}`);
  });

  it('should include task reference in facts', async () => {
    const mock = createMockStore();
    const a1 = store.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });

    await createHandoffArtifact(
      {
        projectId: 'proj1',
        fromAgentId: a1.agent_id,
        taskId: 'task-456',
        summary: 'test',
        context: 'ctx',
      },
      mock.fn,
      store,
    );

    const facts = mock.calls[0].facts as string[];
    expect(facts.some((f: string) => f.includes('task-456'))).toBe(true);
  });

  it('should not throw if message sending fails', async () => {
    const mock = createMockStore();
    // Use a store with broken sendMessage
    const brokenStore = Object.create(store);
    brokenStore.sendMessage = () => { throw new Error('DB error'); };
    brokenStore.listAgents = store.listAgents.bind(store);

    const a1 = store.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });

    // Should not throw — message is best-effort
    const result = await createHandoffArtifact(
      {
        projectId: 'proj1',
        fromAgentId: a1.agent_id,
        summary: 'test',
        context: 'ctx',
      },
      mock.fn,
      brokenStore,
    );

    expect(result.observationId).toBe(1); // observation still created
  });

  // ═══════════════════════════════════════════════════════════════════
  // Codex review: required correctness tests
  // ═══════════════════════════════════════════════════════════════════

  it('should emit handoff:created event after canonical write', async () => {
    const bus = new TeamEventBus();
    store.setEventBus(bus);
    const received: any[] = [];
    bus.on('handoff:created', (data) => received.push(data));

    const mock = createMockStore();
    const a1 = store.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });

    await createHandoffArtifact(
      {
        projectId: 'proj1',
        fromAgentId: a1.agent_id,
        taskId: 'task-99',
        summary: 'test emit',
        context: 'ctx',
      },
      mock.fn,
      store,
    );

    expect(received).toHaveLength(1);
    expect(received[0].observationId).toBe(1);
    expect(received[0].projectId).toBe('proj1');
    expect(received[0].fromAgent).toBe(a1.agent_id);
    expect(received[0].taskId).toBe('task-99');
  });

  it('should not block canonical write when handoff:created listener throws', async () => {
    const bus = new TeamEventBus();
    store.setEventBus(bus);
    bus.on('handoff:created', () => { throw new Error('listener crash'); });

    const mock = createMockStore();
    const a1 = store.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });

    const result = await createHandoffArtifact(
      {
        projectId: 'proj1',
        fromAgentId: a1.agent_id,
        summary: 'survives crash',
        context: 'ctx',
      },
      mock.fn,
      store,
    );

    expect(result.observationId).toBe(1);
    expect(mock.calls).toHaveLength(1); // observation was stored
  });

  it('broadcast handoff: agent A markRead does not affect agent B unread', async () => {
    const mock = createMockStore();
    const a1 = store.registerAgent({ projectId: 'proj1', agentType: 'sender', instanceId: 'i1' });
    const a2 = store.registerAgent({ projectId: 'proj1', agentType: 'reader', instanceId: 'i2' });
    const a3 = store.registerAgent({ projectId: 'proj1', agentType: 'other', instanceId: 'i3' });

    await createHandoffArtifact(
      {
        projectId: 'proj1',
        fromAgentId: a1.agent_id,
        summary: 'broadcast isolation test',
        context: 'ctx',
      },
      mock.fn,
      store,
    );

    // Both agents see unread
    expect(store.getUnreadCount('proj1', a2.agent_id)).toBe(1);
    expect(store.getUnreadCount('proj1', a3.agent_id)).toBe(1);

    // Agent A2 marks all read
    store.markAllRead('proj1', a2.agent_id);

    // Agent A2 now has 0 unread, but A3 still has 1
    expect(store.getUnreadCount('proj1', a2.agent_id)).toBe(0);
    expect(store.getUnreadCount('proj1', a3.agent_id)).toBe(1);
  });

  it('targeted handoff (with toAgentId) semantics unchanged', async () => {
    const mock = createMockStore();
    const a1 = store.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });
    const a2 = store.registerAgent({ projectId: 'proj1', agentType: 'test2', instanceId: 'i2' });
    const a3 = store.registerAgent({ projectId: 'proj1', agentType: 'test3', instanceId: 'i3' });

    await createHandoffArtifact(
      {
        projectId: 'proj1',
        fromAgentId: a1.agent_id,
        toAgentId: a2.agent_id,
        summary: 'targeted only',
        context: 'ctx',
      },
      mock.fn,
      store,
    );

    // Only a2 gets the message, not a3
    const inbox2 = store.getInbox('proj1', a2.agent_id);
    const inbox3 = store.getInbox('proj1', a3.agent_id);
    expect(inbox2.filter(m => m.type === 'handoff')).toHaveLength(1);
    expect(inbox3.filter(m => m.type === 'handoff')).toHaveLength(0);
  });

  it('existing direct message behavior not regressed', () => {
    const a1 = store.registerAgent({ projectId: 'proj1', agentType: 'test', instanceId: 'i1' });
    const a2 = store.registerAgent({ projectId: 'proj1', agentType: 'test2', instanceId: 'i2' });
    const a3 = store.registerAgent({ projectId: 'proj1', agentType: 'test3', instanceId: 'i3' });

    // Send a direct (non-handoff) message
    store.sendMessage({
      projectId: 'proj1',
      senderAgentId: a1.agent_id,
      recipientAgentId: a2.agent_id,
      type: 'info',
      content: 'direct message',
    });

    // Only a2 sees it
    expect(store.getUnreadCount('proj1', a2.agent_id)).toBe(1);
    expect(store.getInbox('proj1', a3.agent_id).filter(m => m.type === 'info')).toHaveLength(0);

    // markRead only affects a2
    store.markAllRead('proj1', a2.agent_id);
    expect(store.getUnreadCount('proj1', a2.agent_id)).toBe(0);

    // a3 is unaffected (had no messages)
    expect(store.getUnreadCount('proj1', a3.agent_id)).toBe(0);
  });
});
