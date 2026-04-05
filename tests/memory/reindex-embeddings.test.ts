import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResetDb = vi.fn();
const mockBatchGenerateEmbeddings = vi.fn();
const mockInsertObservation = vi.fn();
const mockLoadObservationsJson = vi.fn();
const mockLoadIdCounter = vi.fn();
const mockGetVectorDimensions = vi.fn();
const mockGetEmbeddingProvider = vi.fn();
const mockIsEmbeddingExplicitlyDisabled = vi.fn();

vi.mock('../../src/store/orama-store.js', () => ({
  insertObservation: mockInsertObservation,
  removeObservation: vi.fn(),
  resetDb: mockResetDb,
  generateEmbedding: vi.fn(),
  batchGenerateEmbeddings: mockBatchGenerateEmbeddings,
  getVectorDimensions: mockGetVectorDimensions,
  makeOramaObservationId: (projectId: string, observationId: number) => `${projectId}:${observationId}`,
}));

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: mockGetEmbeddingProvider,
  isEmbeddingExplicitlyDisabled: mockIsEmbeddingExplicitlyDisabled,
  resetProvider: vi.fn(),
}));

vi.mock('../../src/store/persistence.js', () => ({
  saveObservationsJson: vi.fn(),
  loadObservationsJson: mockLoadObservationsJson,
  saveIdCounter: vi.fn(),
  loadIdCounter: mockLoadIdCounter,
}));

vi.mock('../../src/store/file-lock.js', () => ({
  withFileLock: async (_dir: string, _name: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../../src/store/sqlite-store.js', () => ({
  SqliteBackend: class { async init() { throw new Error('SQLite disabled in test'); } close() {} },
}));

vi.mock('../../src/compact/token-budget.js', () => ({
  countTextTokens: () => 0,
}));

vi.mock('../../src/memory/entity-extractor.js', () => ({
  extractEntities: () => [],
  enrichConcepts: (concepts: string[]) => concepts,
}));

describe('reindexObservations', () => {
  beforeEach(() => {
    vi.resetModules();
    mockResetDb.mockReset();
    mockBatchGenerateEmbeddings.mockReset();
    mockInsertObservation.mockReset();
    mockLoadObservationsJson.mockReset();
    mockLoadIdCounter.mockReset();
    mockGetVectorDimensions.mockReset();
    mockGetEmbeddingProvider.mockReset();
    mockIsEmbeddingExplicitlyDisabled.mockReset();
    mockGetVectorDimensions.mockReturnValue(null);
    mockGetEmbeddingProvider.mockResolvedValue({
      name: 'fastembed-bge-small-en-v1.5',
      dimensions: 384,
      embed: vi.fn(),
      embedBatch: vi.fn(),
    });
    mockIsEmbeddingExplicitlyDisabled.mockReturnValue(false);
  });

  it('rebuilds historical observations with batch embeddings after reset', async () => {
    mockLoadObservationsJson.mockResolvedValue([
      {
        id: 1,
        projectId: 'AVIDS2/memorix',
        entityName: 'search-layer',
        type: 'what-changed',
        title: 'Semantic retrieval hardening',
        narrative: 'Reindexed old observations after enabling embeddings.',
        facts: ['Batch reindex should regenerate vectors'],
        filesModified: ['src/memory/observations.ts'],
        concepts: ['embedding', 'reindex'],
        tokens: 42,
        createdAt: '2026-03-18T00:00:00.000Z',
        status: 'active',
        source: 'agent',
      },
      {
        id: 2,
        projectId: 'AVIDS2/memorix',
        entityName: 'quality-check',
        type: 'discovery',
        title: 'Historical memories need vectors',
        narrative: 'Old observations were missing semantic embeddings.',
        facts: ['Rebuild should preserve searchable vector state'],
        filesModified: ['src/store/orama-store.ts'],
        concepts: ['semantic-search'],
        tokens: 30,
        createdAt: '2026-03-18T00:00:01.000Z',
        status: 'active',
        source: 'git',
      },
    ]);
    mockLoadIdCounter.mockResolvedValue(3);
    mockBatchGenerateEmbeddings.mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]);

    const { initObservations, reindexObservations } = await import('../../src/memory/observations.js');

    await initObservations('E:/tmp/project');
    const count = await reindexObservations();

    expect(count).toBe(2);
    expect(mockResetDb).toHaveBeenCalledOnce();
    expect(mockBatchGenerateEmbeddings).toHaveBeenCalledOnce();
    expect(mockBatchGenerateEmbeddings).toHaveBeenCalledWith([
      'Semantic retrieval hardening Reindexed old observations after enabling embeddings. Batch reindex should regenerate vectors',
      'Historical memories need vectors Old observations were missing semantic embeddings. Rebuild should preserve searchable vector state',
    ]);
    expect(mockInsertObservation).toHaveBeenCalledTimes(2);
    expect(mockInsertObservation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: 'AVIDS2/memorix:1',
        observationId: 1,
        embedding: [0.1, 0.2],
      }),
    );
    expect(mockInsertObservation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: 'AVIDS2/memorix:2',
        observationId: 2,
        embedding: [0.3, 0.4],
      }),
    );
  });
});
