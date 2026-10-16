import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Observation } from '../../src/types.js';

const state = vi.hoisted(() => ({
  semanticHits: vi.fn(),
  provider: {
    name: 'recovery-test-provider',
    dimensions: 2,
    embed: vi.fn(async () => [1, 0]),
  },
}));

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: vi.fn(async () => state.provider),
  isEmbeddingExplicitlyDisabled: vi.fn(() => false),
  resetProvider: vi.fn(),
}));

vi.mock('../../src/search/semantic-index.js', () => ({
  createSemanticIndexProfile: vi.fn(() => ({ key: 'recovery-test-provider:2', provider: 'recovery-test-provider', dimensions: 2 })),
  searchSemanticVectors: state.semanticHits,
  upsertSemanticVectors: vi.fn(async () => undefined),
}));

import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import {
  getObservationStore,
  initObservationStore,
  resetObservationStore,
} from '../../src/store/obs-store.js';
import { initObservations, resetObservationRuntime } from '../../src/memory/observations.js';
import { resetDb, searchObservations } from '../../src/store/orama-store.js';

function observation(): Observation {
  return {
    id: 1,
    entityName: 'recovery-project',
    type: 'problem-solution',
    title: 'Maintenance search recovery',
    narrative: 'Lexical memory must remain available when a derived semantic index is stale.',
    facts: ['fallback=lexical'],
    filesModified: [],
    concepts: ['maintenance', 'recovery'],
    tokens: 20,
    createdAt: '2026-10-11T00:00:00.000Z',
    projectId: 'recovery-project',
    status: 'active',
  };
}

describe('persistent semantic search recovery', () => {
  let dataDir = '';
  const previousThreshold = process.env.MEMORIX_ORAMA_HYDRATION_THRESHOLD;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-semantic-recovery-'));
    process.env.MEMORIX_ORAMA_HYDRATION_THRESHOLD = '1';
    await initObservationStore(dataDir);
    await getObservationStore().insert(observation());
    await initObservations(dataDir);
    await resetDb();
    state.semanticHits.mockResolvedValue([
      { observationId: 999, projectId: 'recovery-project', distance: 0.01 },
    ]);
  });

  afterEach(async () => {
    resetObservationRuntime();
    resetObservationStore();
    closeAllDatabases();
    await resetDb();
    state.semanticHits.mockReset();
    if (previousThreshold === undefined) delete process.env.MEMORIX_ORAMA_HYDRATION_THRESHOLD;
    else process.env.MEMORIX_ORAMA_HYDRATION_THRESHOLD = previousThreshold;
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    dataDir = '';
  });

  it('retries the durable lexical path after an empty stale semantic result', async () => {
    const store = getObservationStore();
    const searchLexical = store.searchLexical!.bind(store);
    let calls = 0;
    store.searchLexical = async (options) => {
      calls++;
      return calls === 1 ? [] : searchLexical(options);
    };

    const entries = await searchObservations({
      query: 'maintenance recovery',
      projectId: 'recovery-project',
      limit: 5,
    });

    expect(entries[0]?.title).toBe('Maintenance search recovery');
    expect(calls).toBe(2);
  });
});
