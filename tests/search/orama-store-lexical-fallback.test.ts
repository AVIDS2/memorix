import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { createObservationStore, resetObservationStore, setObservationStore } from '../../src/store/obs-store.js';
import type { Observation } from '../../src/types.js';

// A real embedding provider is configured (getEmbeddingProvider resolves), so
// `embeddingEnabled` becomes true when orama-store initializes its schema —
// but every actual per-query call throws, reproducing a runtime TLS/network
// failure against a live, otherwise-working embedding endpoint.
const flakyProvider = {
  name: 'flaky-api',
  dimensions: 2,
  async embed(): Promise<number[]> {
    throw new Error('fetch failed');
  },
  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => [0, 0]);
  },
};

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: vi.fn(async () => flakyProvider),
  isEmbeddingExplicitlyDisabled: vi.fn(() => false),
  resetProvider: vi.fn(),
}));

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: 1,
    entityName: 'erp-module',
    type: 'decision',
    title: 'ErpStockProcessServiceImpl handles concurrent claims',
    narrative: 'ErpStockProcessServiceImpl orders the atomic claim before any validation read.',
    facts: ['pattern=atomic-claim-first'],
    filesModified: ['src/main/ErpStockProcessServiceImpl.java'],
    concepts: ['erp', 'concurrency'],
    tokens: 30,
    createdAt: '2026-09-26T00:00:00.000Z',
    projectId: 'project-large-corpus',
    status: 'active',
    ...overrides,
  };
}

describe('persistent lexical fallback when a configured embedding provider fails at runtime', () => {
  let dataDir: string;
  const originalThreshold = process.env.MEMORIX_ORAMA_HYDRATION_THRESHOLD;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-lexical-fallback-'));
    // Force "large corpus" persistent mode with just one observation, instead
    // of needing 10k+ real rows to reach the default threshold.
    process.env.MEMORIX_ORAMA_HYDRATION_THRESHOLD = '1';
    const store = await createObservationStore(dataDir);
    setObservationStore(store);
    await store.insert(observation());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    resetObservationStore();
    closeAllDatabases();
    process.env.MEMORIX_ORAMA_HYDRATION_THRESHOLD = originalThreshold;
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('still returns the FTS5 match instead of a silent empty result', async () => {
    const { resetDb, searchObservations } = await import('../../src/store/orama-store.js');
    await resetDb();

    const entries = await searchObservations({
      query: 'ErpStockProcessServiceImpl',
      projectId: 'project-large-corpus',
      limit: 5,
    });

    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.title).toContain('ErpStockProcessServiceImpl');
  });
});
