import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResetDb = vi.fn();
const mockBatchGenerateEmbeddings = vi.fn();
const mockHydrateIndex = vi.fn();
const mockInsertObservation = vi.fn();
const mockLoadObservationsJson = vi.fn();
const mockLoadIdCounter = vi.fn();
const mockIsEmbeddingEnabled = vi.fn();

vi.mock('../../src/store/orama-store.js', () => ({
  insertObservation: mockInsertObservation,
  removeObservation: vi.fn(),
  resetDb: mockResetDb,
  generateEmbedding: vi.fn(),
  batchGenerateEmbeddings: mockBatchGenerateEmbeddings,
  hydrateIndex: mockHydrateIndex,
  isEmbeddingEnabled: mockIsEmbeddingEnabled,
  makeOramaObservationId: (projectId: string, observationId: number) => `${projectId}:${observationId}`,
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

describe('prepareSearchIndex', () => {
  beforeEach(() => {
    vi.resetModules();
    mockResetDb.mockReset();
    mockBatchGenerateEmbeddings.mockReset();
    mockHydrateIndex.mockReset();
    mockInsertObservation.mockReset();
    mockLoadObservationsJson.mockReset();
    mockLoadIdCounter.mockReset();
    mockIsEmbeddingEnabled.mockReset();
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
    mockHydrateIndex.mockResolvedValue(2);
    mockIsEmbeddingEnabled.mockReturnValue(true);

    const { initObservations, prepareSearchIndex, getVectorMissingIds } = await import('../../src/memory/observations.js');

    await initObservations('E:/tmp/project');
    const count = await prepareSearchIndex();

    expect(count).toBe(2);
    expect(mockResetDb).toHaveBeenCalledOnce();
    expect(mockHydrateIndex).toHaveBeenCalledOnce();
    expect(mockHydrateIndex).toHaveBeenCalledWith(
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
    mockHydrateIndex.mockResolvedValue(1);
    mockIsEmbeddingEnabled.mockReturnValue(false);

    const { initObservations, prepareSearchIndex, getVectorMissingIds } = await import('../../src/memory/observations.js');

    await initObservations('E:/tmp/project');
    await prepareSearchIndex();

    expect(mockBatchGenerateEmbeddings).not.toHaveBeenCalled();
    expect(getVectorMissingIds()).toEqual([]);
  });
});
