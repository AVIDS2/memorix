/**
 * Hook writes must persist to SQLite without materializing the full corpus.
 * loadAll() of 40k+ rows is what made PostToolUse hang and forced OpenCode
 * to skip per-tool events.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: async () => null,
  isVectorSearchAvailable: async () => false,
  isEmbeddingExplicitlyDisabled: () => true,
  resetProvider: () => {},
  validateEmbeddingInput: () => {},
}));

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initObservations,
  storeObservation,
  getAllObservations,
  resetObservationRuntime,
} from '../../src/memory/observations.js';
import {
  initObservationStore,
  getObservationStore,
  resetObservationStore,
} from '../../src/store/obs-store.js';
import { resetDb } from '../../src/store/orama-store.js';
import { closeDatabase } from '../../src/store/sqlite-db.js';
import type { Observation } from '../../src/types.js';

function makeObs(id: number): Observation {
  return {
    id,
    entityName: `seed-${id}`,
    type: 'discovery',
    title: `Seed observation ${id}`,
    narrative: 'Existing corpus row that hooks must not load.',
    facts: [],
    filesModified: [],
    concepts: [],
    tokens: 8,
    createdAt: new Date().toISOString(),
    projectId: 'test/hook-write',
    status: 'active',
    source: 'agent',
  };
}

let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-hook-write-'));
  resetObservationRuntime();
  resetObservationStore();
  await resetDb();
  await initObservationStore(testDir);
  const store = getObservationStore();
  for (let id = 1; id <= 5; id++) {
    await store.insert(makeObs(id));
  }
  await store.saveIdCounter(6);
});

afterEach(() => {
  resetObservationRuntime();
  resetObservationStore();
  closeDatabase(testDir);
  fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
});

describe('hook write without corpus load', () => {
  it('does not call loadAll when skipCorpusLoad is set', async () => {
    const store = getObservationStore();
    const loadAll = vi.spyOn(store, 'loadAll');

    await initObservations(testDir, {
      skipCorpusLoad: true,
      embeddingWriteMode: 'deferred',
    });

    expect(loadAll).not.toHaveBeenCalled();
    expect(getAllObservations()).toEqual([]);
  });

  it('persists a hook observation to SQLite without loading the existing corpus', async () => {
    const store = getObservationStore();
    const loadAll = vi.spyOn(store, 'loadAll');

    await initObservations(testDir, {
      skipCorpusLoad: true,
      embeddingWriteMode: 'deferred',
    });

    const { observation } = await storeObservation({
      entityName: 'memorix-e2e',
      type: 'what-changed',
      title: 'PostToolUse hook write',
      narrative: 'Native hook capture without hydrating Orama or loadAll.',
      projectId: 'test/hook-write',
      sourceDetail: 'hook',
    });

    expect(loadAll).not.toHaveBeenCalled();
    expect(observation.id).toBe(6);

    const persisted = await store.getById(6);
    expect(persisted?.title).toBe('PostToolUse hook write');
    expect(persisted?.sourceDetail).toBe('hook');

    const all = await store.loadAll();
    expect(all).toHaveLength(6);
  });
});
