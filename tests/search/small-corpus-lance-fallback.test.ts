import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Observation } from '../../src/types.js';

const state = vi.hoisted(() => ({
  semanticHits: vi.fn(),
  provider: {
    name: 'small-corpus-provider',
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
  createSemanticIndexProfile: vi.fn(() => ({ key: 'small-corpus-provider:2', provider: 'small-corpus-provider', dimensions: 2 })),
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
    id: 7,
    entityName: 'small-project',
    type: 'problem-solution',
    title: 'Maintenance search recovery',
    narrative: 'A project under the Orama hydration threshold still keeps its lexical row.',
    facts: ['fallback=lexical'],
    filesModified: [],
    concepts: ['maintenance', 'recovery'],
    tokens: 20,
    createdAt: '2026-11-26T00:00:00.000Z',
    projectId: 'small-project',
    status: 'active',
  };
}

describe('small corpus Lance fallback', () => {
  let dataDir = '';
  const previousThreshold = process.env.MEMORIX_ORAMA_HYDRATION_THRESHOLD;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-small-corpus-'));
    delete process.env.MEMORIX_ORAMA_HYDRATION_THRESHOLD;
    await initObservationStore(dataDir);
    await getObservationStore().insert(observation());
    await initObservations(dataDir);
    await resetDb();
    state.semanticHits.mockResolvedValue([]);
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

  it('fuses an empty Lance hit list with FTS when the project is under 10000', async () => {
    const entries = await searchObservations({
      query: 'maintenance recovery',
      projectId: 'small-project',
      limit: 5,
    });

    expect(state.semanticHits).toHaveBeenCalled();
    expect(entries.map((entry) => entry.title)).toContain('Maintenance search recovery');
  });
});
