import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResetDb = vi.fn();
const mockBatchGenerateEmbeddings = vi.fn();
const mockHydrateIndexForStartup = vi.fn();
const mockInsertObservation = vi.fn();
const mockLoadObservationsJson = vi.fn();
const mockLoadIdCounter = vi.fn();
const mockIsEmbeddingEnabled = vi.fn();
const mockHasObservationVector = vi.fn();
const mockDeferredCachedVectorHydration = vi.fn();
const mockIsEmbeddingExplicitlyDisabled = vi.fn();

vi.mock('../../src/store/orama-store.js', () => ({
  insertObservation: mockInsertObservation,
  removeObservation: vi.fn(),
  resetDb: mockResetDb,
  generateEmbedding: vi.fn(),
  batchGenerateEmbeddings: mockBatchGenerateEmbeddings,
  getDb: vi.fn(),
  hydrateIndex: vi.fn(),
  hydrateIndexForStartup: mockHydrateIndexForStartup,
  getDeferredCachedVectorHydration: mockDeferredCachedVectorHydration,
  isEmbeddingEnabled: mockIsEmbeddingEnabled,
  hasObservationVector: mockHasObservationVector,
  makeOramaObservationId: (projectId: string, observationId: number) => `${projectId}:${observationId}`,
  getLastSearchMode: vi.fn(() => 'fulltext'),
  searchObservations: vi.fn(),
}));

vi.mock('../../src/store/persistence.js', () => ({
  saveObservationsJson: vi.fn(),
  loadObservationsJson: mockLoadObservationsJson,
  saveIdCounter: vi.fn(),
  loadIdCounter: mockLoadIdCounter,
}));

vi.mock('../../src/store/obs-store.js', () => ({
  initObservationStore: vi.fn().mockResolvedValue(undefined),
  getObservationStore: () => ({
    loadAll: mockLoadObservationsJson,
    loadIdCounter: mockLoadIdCounter,
    ensureFresh: vi.fn().mockResolvedValue(false),
    close: vi.fn(),
    getBackendName: () => 'json',
    getGeneration: () => 0,
  }),
}));

vi.mock('../../src/store/file-lock.js', () => ({
  withFileLock: async (_dir: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../../src/compact/token-budget.js', () => ({
  countTextTokens: () => 0,
}));

vi.mock('../../src/memory/entity-extractor.js', () => ({
  extractEntities: () => [],
  enrichConcepts: (concepts: string[]) => concepts,
}));

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: vi.fn(),
  isEmbeddingExplicitlyDisabled: mockIsEmbeddingExplicitlyDisabled,
}));

describe('prepareSearchIndex', () => {
  beforeEach(() => {
    vi.resetModules();
    mockResetDb.mockReset();
    mockBatchGenerateEmbeddings.mockReset();
    mockHydrateIndexForStartup.mockReset();
    mockInsertObservation.mockReset();
    mockLoadObservationsJson.mockReset();
    mockLoadIdCounter.mockReset();
    mockIsEmbeddingEnabled.mockReset();
    mockHasObservationVector.mockReset();
    mockHasObservationVector.mockReturnValue(false);
    mockDeferredCachedVectorHydration.mockReset();
    mockDeferredCachedVectorHydration.mockReturnValue(null);
    mockIsEmbeddingExplicitlyDisabled.mockReset();
    mockIsEmbeddingExplicitlyDisabled.mockReturnValue(false);
  });

  it('hydrates the lexical index without triggering batch embeddings and queues active docs for backfill', async () => {
    mockLoadObservationsJson.mockResolvedValue([
      {
        id: 1,
        projectId: 'AVIDS2/memorix',
        entityName: 'search-layer',
        type: 'what-changed',
        title: 'Prepared startup index',
        narrative: 'Build lexical index first, defer vectors.',
        facts: ['Startup should not block on embeddings'],
        filesModified: ['src/server.ts'],
        concepts: ['startup-index'],
        tokens: 42,
        createdAt: '2026-03-18T00:00:00.000Z',
        status: 'active',
        source: 'agent',
      },
      {
        id: 2,
        projectId: 'AVIDS2/memorix',
        entityName: 'history',
        type: 'decision',
        title: 'Resolved old note',
        narrative: 'Should stay out of the backfill queue.',
        facts: [],
        filesModified: [],
        concepts: ['resolved'],
        tokens: 12,
        createdAt: '2026-03-18T00:00:01.000Z',
        status: 'resolved',
        source: 'agent',
      },
    ]);
    mockLoadIdCounter.mockResolvedValue(3);
    mockHydrateIndexForStartup.mockResolvedValue(2);
    mockIsEmbeddingEnabled.mockReturnValue(true);

    const { initObservations, prepareSearchIndex, getVectorMissingIds } = await import('../../src/memory/observations.ts');

    await initObservations('E:/tmp/project');
    const count = await prepareSearchIndex();

    expect(count).toBe(2);
    expect(mockResetDb).not.toHaveBeenCalled();
    expect(mockHydrateIndexForStartup).toHaveBeenCalledOnce();
    expect(mockHydrateIndexForStartup).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 1, title: 'Prepared startup index' }),
        expect.objectContaining({ id: 2, title: 'Resolved old note' }),
      ]),
    );
    expect(mockBatchGenerateEmbeddings).not.toHaveBeenCalled();
    expect(getVectorMissingIds()).toEqual([1, 2]);
  });

  it('leaves the backfill queue empty when vector search is not enabled', async () => {
    mockLoadObservationsJson.mockResolvedValue([
      {
        id: 7,
        projectId: 'AVIDS2/memorix',
        entityName: 'fallback',
        type: 'discovery',
        title: 'Fulltext only startup',
        narrative: 'Embedding provider disabled.',
        facts: [],
        filesModified: [],
        concepts: ['bm25'],
        tokens: 9,
        createdAt: '2026-03-18T00:00:00.000Z',
        status: 'active',
        source: 'agent',
      },
    ]);
    mockLoadIdCounter.mockResolvedValue(8);
    mockHydrateIndexForStartup.mockResolvedValue(1);
    mockIsEmbeddingEnabled.mockReturnValue(false);
    mockIsEmbeddingExplicitlyDisabled.mockReturnValue(true);

    const { initObservations, prepareSearchIndex, getVectorMissingIds } = await import('../../src/memory/observations.ts');

    await initObservations('E:/tmp/project');
    await prepareSearchIndex();

    expect(mockBatchGenerateEmbeddings).not.toHaveBeenCalled();
    expect(getVectorMissingIds()).toEqual([]);
  });

  it('does not reset an already prepared search index during status refreshes', async () => {
    mockLoadObservationsJson.mockResolvedValue([
      {
        id: 9,
        projectId: 'AVIDS2/memorix',
        entityName: 'footer-status',
        type: 'discovery',
        title: 'Status should be idempotent',
        narrative: 'Repeated status checks should not rebuild the index.',
        facts: [],
        filesModified: [],
        concepts: ['status'],
        tokens: 9,
        createdAt: '2026-03-18T00:00:00.000Z',
        status: 'active',
        source: 'agent',
      },
    ]);
    mockLoadIdCounter.mockResolvedValue(10);
    mockHydrateIndexForStartup.mockResolvedValue(1);
    mockIsEmbeddingEnabled.mockReturnValue(true);

    const { initObservations, prepareSearchIndex, getVectorMissingIds } = await import('../../src/memory/observations.ts');

    await initObservations('E:/tmp/project');
    const first = await prepareSearchIndex();
    const second = await prepareSearchIndex();

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(mockResetDb).not.toHaveBeenCalled();
    expect(mockHydrateIndexForStartup).toHaveBeenCalledOnce();
    expect(getVectorMissingIds()).toEqual([9]);
  });

  it('does not mark a prepared index stale when initObservations is called again for the same data dir', async () => {
    mockLoadObservationsJson.mockResolvedValue([
      {
        id: 11,
        projectId: 'AVIDS2/memorix',
        entityName: 'runtime-status',
        type: 'discovery',
        title: 'Runtime status is stable',
        narrative: 'Repeated status reads should reuse the prepared index.',
        facts: [],
        filesModified: [],
        concepts: ['status'],
        tokens: 9,
        createdAt: '2026-03-18T00:00:00.000Z',
        status: 'active',
        source: 'agent',
      },
    ]);
    mockLoadIdCounter.mockResolvedValue(12);
    mockHydrateIndexForStartup.mockResolvedValue(1);
    mockIsEmbeddingEnabled.mockReturnValue(true);

    const { initObservations, prepareSearchIndex } = await import('../../src/memory/observations.ts');

    await initObservations('E:/tmp/project');
    await prepareSearchIndex();
    await initObservations('E:/tmp/project');
    await prepareSearchIndex();

    expect(mockResetDb).not.toHaveBeenCalled();
    expect(mockHydrateIndexForStartup).toHaveBeenCalledOnce();
  });

  it('does not reset vectors or queue backfill when an index is already hydrated elsewhere', async () => {
    mockLoadObservationsJson.mockResolvedValue([
      {
        id: 13,
        projectId: 'AVIDS2/memorix',
        entityName: 'split-module-graph',
        type: 'discovery',
        title: 'Hydrated index remains ready',
        narrative: 'A second module graph should not force vectors back to zero.',
        facts: [],
        filesModified: [],
        concepts: ['module-graph'],
        tokens: 9,
        createdAt: '2026-03-18T00:00:00.000Z',
        status: 'active',
        source: 'agent',
      },
    ]);
    mockLoadIdCounter.mockResolvedValue(14);
    mockHydrateIndexForStartup.mockResolvedValue(0);
    mockIsEmbeddingEnabled.mockReturnValue(true);

    const { initObservations, prepareSearchIndex, getVectorMissingIds } = await import('../../src/memory/observations.ts');

    await initObservations('E:/tmp/project');
    const count = await prepareSearchIndex();

    expect(count).toBe(0);
    expect(mockResetDb).not.toHaveBeenCalled();
    expect(mockHydrateIndexForStartup).toHaveBeenCalledOnce();
    expect(getVectorMissingIds()).toEqual([]);
  });
});
