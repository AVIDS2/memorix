import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { EvidenceCardStore } from '../../src/store/evidence-store.js';
import { MemoryFeedbackStore } from '../../src/memory/feedback.js';
import type { Observation } from '../../src/types.js';

let tempDir = '';

afterEach(async () => {
  closeAllDatabases();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

function observation(): Observation {
  return {
    id: 7,
    entityName: 'http',
    type: 'decision',
    title: 'Keep project handle explicit',
    narrative: 'The handle is a durable project binding, not a chat session id.',
    facts: ['Survives service restart'],
    filesModified: ['src/cli/commands/serve-http.ts'],
    concepts: ['mcp', 'stateless'],
    tokens: 18,
    createdAt: '2026-08-23T00:00:00.000Z',
    projectId: 'org/project',
    status: 'active',
    source: 'manual',
    sourceDetail: 'explicit',
    relatedEntities: ['mcp-server'],
  };
}

describe('1.8 persisted evidence and feedback', () => {
  it('persists evidence cards, stale state, and events across a reopened database', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'memorix-evidence-'));
    const first = new EvidenceCardStore();
    await first.init(tempDir);
    const card = first.upsertObservation(observation());
    expect(card.sourceRef).toBe('observation:7');
    expect(card.capturedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.list('org/project')).toHaveLength(1);
    expect(first.markStaleForPaths('org/project', ['src/cli/commands/serve-http.ts'])).toBe(1);
    first.recordEvent('org/project', card.id, 'source-changed', 'HTTP handler changed');

    closeAllDatabases();
    const reopened = new EvidenceCardStore();
    await reopened.init(tempDir);
    const restored = reopened.get('org/project', 'observation', '7');
    expect(restored?.freshness).toBe('stale');
    expect(reopened.listEvents(card.id)).toHaveLength(1);
  });

  it('strengthens, weakens, and revokes feedback without deleting audit history', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'memorix-feedback-'));
    const store = new MemoryFeedbackStore();
    await store.init(tempDir);
    const positive = store.record({
      projectId: 'org/project', candidateKind: 'observation', candidateId: '7',
      signal: 'verification-success', sourceRef: 'test:verification', actor: 'agent-a',
    });
    expect(positive.state.weight).toBeGreaterThan(1);
    expect(positive.state.audit.map((event) => event.id)).toEqual([positive.event.id]);
    const negative = store.record({
      projectId: 'org/project', candidateKind: 'observation', candidateId: '7',
      signal: 'user-correction', sourceRef: 'test:user', actor: 'human', note: 'The premise changed.',
    });
    expect(negative.state.weight).toBeLessThan(positive.state.weight);
    expect(negative.state.audit.map((event) => event.id)).toEqual([positive.event.id, negative.event.id]);
    const revoked = store.record({
      projectId: 'org/project', candidateKind: 'observation', candidateId: '7',
      signal: 'revoke', sourceRef: 'test:undo', actor: 'human', targetEventId: negative.event.id,
    });
    expect(revoked.state.weight).toBe(positive.state.weight);
    const auditIds = revoked.state.audit.map((event) => event.id);
    expect(auditIds).toEqual([positive.event.id, negative.event.id, revoked.event.id]);
    expect(new Set(auditIds).size).toBe(auditIds.length);
    expect(store.audit('org/project', 'observation', '7')).toHaveLength(3);
  });
});
