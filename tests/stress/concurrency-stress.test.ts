import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initObservations, storeObservation } from '../../src/memory/observations.js';
import { initObservationStore, getObservationStore, resetObservationStore } from '../../src/store/obs-store.js';
import { resetDb } from '../../src/store/orama-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

/**
 * Concurrency stress exam: parallel writes and parallel same-topic upserts
 * must never lose records or corrupt the store. Deterministic, offline.
 */

const projectId = 'stress/concurrency';
let sandbox = '';

describe('concurrency stress exam', () => {
  beforeEach(() => {
    sandbox = mkdtempSync(path.join(tmpdir(), 'memorix-stress-concurrency-'));
    process.env.MEMORIX_EMBEDDING = 'off';
  });

  afterEach(async () => {
    resetObservationStore();
    await resetDb();
    closeAllDatabases();
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
    sandbox = '';
  });

  it('persists 60 parallel writes with zero loss', async () => {
    await initObservationStore(path.join(sandbox, 'data'));
    await initObservations(path.join(sandbox, 'data'));

    const writes = Array.from({ length: 60 }, (_, i) => storeObservation({
      entityName: `entity-${i % 6}`,
      type: 'what-changed',
      title: `parallel write ${i}`,
      narrative: `Concurrent record ${i} must survive.`,
      projectId,
      source: 'manual',
    }));
    const results = await Promise.all(writes);

    expect(results).toHaveLength(60);
    const ids = results.map((result) => result.observation.id);
    expect(new Set(ids).size).toBe(60);

    const persisted = await getObservationStore().loadByProject(projectId, { status: 'active' });
    expect(persisted.length).toBe(60);
    expect(new Set(persisted.map((obs) => obs.title)).size).toBe(60);
  }, 60_000);

  it('keeps exactly one active record per topicKey under parallel upserts', async () => {
    await initObservationStore(path.join(sandbox, 'data'));
    await initObservations(path.join(sandbox, 'data'));

    const upserts = Array.from({ length: 20 }, (_, i) => storeObservation({
      entityName: 'shared-entity',
      type: 'decision',
      title: `topic revision ${i}`,
      narrative: `Revision ${i} of the evolving topic.`,
      projectId,
      topicKey: 'stress-topic',
      source: 'manual',
    }));
    const results = await Promise.all(upserts);
    expect(results).toHaveLength(20);
    // The first write inserts; the rest must upsert onto the same topic.
    expect(results.some((result) => result.upserted === true)).toBe(true);

    const active = await getObservationStore().loadByProject(projectId, { status: 'active' });
    const topicRecords = active.filter((obs) => obs.topicKey === 'stress-topic');
    expect(topicRecords, 'parallel upserts must not duplicate the topic').toHaveLength(1);
    expect(topicRecords[0].revisionCount).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
