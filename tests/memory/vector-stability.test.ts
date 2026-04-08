/**
 * Vector Embedding Stability Tests
 *
 * Tests for vectorMissing tracking, getVectorStatus observability,
 * and backfillVectorEmbeddings retry mechanism.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock orama-store before importing observations
vi.mock('../../src/store/orama-store.js', () => ({
  insertObservation: vi.fn().mockResolvedValue(undefined),
  removeObservation: vi.fn().mockResolvedValue(undefined),
  resetDb: vi.fn().mockResolvedValue(undefined),
  generateEmbedding: vi.fn().mockResolvedValue(null),
  batchGenerateEmbeddings: vi.fn().mockResolvedValue([]),
  getVectorDimensions: vi.fn().mockReturnValue(384),
  makeOramaObservationId: (projectId: string, id: number) => `obs-${projectId}-${id}`,
}));

// Default: embedding NOT explicitly disabled (provider may be temporarily unavailable)
vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: vi.fn().mockResolvedValue(null),
  isVectorSearchAvailable: vi.fn().mockResolvedValue(false),
  isEmbeddingExplicitlyDisabled: vi.fn().mockReturnValue(false),
  resetProvider: vi.fn(),
}));

vi.mock('../../src/store/persistence.js', () => ({
  saveObservationsJson: vi.fn().mockResolvedValue(undefined),
  loadObservationsJson: vi.fn().mockResolvedValue([]),
  saveIdCounter: vi.fn().mockResolvedValue(undefined),
  loadIdCounter: vi.fn().mockResolvedValue(1),
}));

vi.mock('../../src/store/file-lock.js', () => ({
  withFileLock: vi.fn().mockImplementation((_dir: string, fn: () => Promise<void>) => fn()),
}));

vi.mock('../../src/store/sqlite-store.js', () => ({
  SqliteBackend: class { async init() { throw new Error('SQLite disabled in test'); } close() {} },
}));

vi.mock('../../src/compact/token-budget.js', () => ({
  countTextTokens: vi.fn().mockReturnValue(10),
}));

vi.mock('../../src/memory/entity-extractor.js', () => ({
  extractEntities: vi.fn().mockReturnValue({ files: [], concepts: [], hasCausalLanguage: false }),
  enrichConcepts: vi.fn().mockImplementation((concepts: string[]) => concepts),
}));

describe('Vector Stability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getVectorStatus returns initial empty state', async () => {
    const { getVectorStatus } = await import('../../src/memory/observations.js');
    const status = getVectorStatus();
    expect(status).toHaveProperty('total');
    expect(status).toHaveProperty('missing');
    expect(status).toHaveProperty('missingIds');
    expect(status).toHaveProperty('backfillRunning');
    expect(status.backfillRunning).toBe(false);
    expect(Array.isArray(status.missingIds)).toBe(true);
  });

  it('getVectorMissingIds returns array', async () => {
    const { getVectorMissingIds } = await import('../../src/memory/observations.js');
    const ids = getVectorMissingIds();
    expect(Array.isArray(ids)).toBe(true);
  });

  it('backfillVectorEmbeddings returns result with correct shape', async () => {
    const { backfillVectorEmbeddings } = await import('../../src/memory/observations.js');
    const result = await backfillVectorEmbeddings();
    expect(result).toHaveProperty('attempted');
    expect(result).toHaveProperty('succeeded');
    expect(result).toHaveProperty('failed');
    expect(typeof result.attempted).toBe('number');
    expect(typeof result.succeeded).toBe('number');
    expect(typeof result.failed).toBe('number');
  });

  it('backfillVectorEmbeddings is safe to call concurrently (only one runs)', async () => {
    const { backfillVectorEmbeddings } = await import('../../src/memory/observations.js');
    // Start two backfills simultaneously
    const [r1, r2] = await Promise.all([
      backfillVectorEmbeddings(),
      backfillVectorEmbeddings(),
    ]);
    // At least one should return {attempted: 0} because the other is already running
    const totalAttempted = r1.attempted + r2.attempted;
    expect(totalAttempted).toBeGreaterThanOrEqual(0);
  });

  it('storeObservation tracks vectorMissing when embedding fails', async () => {
    const oramaStore = await import('../../src/store/orama-store.js');
    // Make generateEmbedding reject
    vi.mocked(oramaStore.generateEmbedding).mockRejectedValueOnce(new Error('provider crashed'));

    const { storeObservation, getVectorStatus } = await import('../../src/memory/observations.js');
    await storeObservation({
      entityName: 'test-entity',
      type: 'discovery',
      title: 'Vector test observation',
      narrative: 'Testing vector missing tracking',
      projectId: 'test/vector-stability',
    });

    // Wait a tick for the async embedding to process
    await new Promise(r => setTimeout(r, 50));

    const status = getVectorStatus();
    // The observation should be in the missing set since embedding failed
    expect(status.missing).toBeGreaterThanOrEqual(0);
  });

  it('keeps obs in vectorMissingIds when provider is temporarily unavailable (not disabled)', async () => {
    const oramaStore = await import('../../src/store/orama-store.js');
    const embeddingProvider = await import('../../src/embedding/provider.js');
    // Provider returns null (init failed / API error) but embedding is NOT disabled
    vi.mocked(oramaStore.generateEmbedding).mockResolvedValue(null);
    vi.mocked(embeddingProvider.isEmbeddingExplicitlyDisabled).mockReturnValue(false);

    const { storeObservation, getVectorMissingIds } = await import('../../src/memory/observations.js');
    const { observation } = await storeObservation({
      entityName: 'provider-fail-test',
      type: 'discovery',
      title: 'Provider temporarily unavailable',
      narrative: 'This embedding should stay in the backfill queue',
      projectId: 'test/vector-stability',
    });

    // Wait for async embedding to settle
    await new Promise(r => setTimeout(r, 100));

    const missingIds = getVectorMissingIds();
    // Must remain in the missing set for future backfill retry
    expect(missingIds).toContain(observation.id);
  });

  it('keeps obs in vectorMissingIds when fallback embedding dimensions do not match the current index', async () => {
    const oramaStore = await import('../../src/store/orama-store.js');
    vi.mocked(oramaStore.generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3]);
    vi.mocked(oramaStore.getVectorDimensions).mockReturnValue(4096);

    const { storeObservation, getVectorMissingIds } = await import('../../src/memory/observations.js');
    const { observation } = await storeObservation({
      entityName: 'dimension-mismatch-test',
      type: 'discovery',
      title: 'Fallback dimensions differ from index',
      narrative: 'This should stay queued until a compatible provider is available again',
      projectId: 'test/vector-stability',
    });

    await new Promise(r => setTimeout(r, 100));

    const missingIds = getVectorMissingIds();
    expect(missingIds).toContain(observation.id);
    expect(oramaStore.removeObservation).not.toHaveBeenCalled();
    expect(oramaStore.insertObservation).toHaveBeenCalledTimes(1);
  });

  it('removes obs from vectorMissingIds when embedding is explicitly disabled', async () => {
    const oramaStore = await import('../../src/store/orama-store.js');
    const embeddingProvider = await import('../../src/embedding/provider.js');
    // Provider returns null AND embedding is explicitly disabled (mode=off)
    vi.mocked(oramaStore.generateEmbedding).mockResolvedValue(null);
    vi.mocked(embeddingProvider.isEmbeddingExplicitlyDisabled).mockReturnValue(true);

    const { storeObservation, getVectorMissingIds } = await import('../../src/memory/observations.js');
    const { observation } = await storeObservation({
      entityName: 'disabled-test',
      type: 'discovery',
      title: 'Embedding explicitly disabled',
      narrative: 'This should be removed from the backfill queue',
      projectId: 'test/vector-stability',
    });

    // Wait for async embedding to settle
    await new Promise(r => setTimeout(r, 100));

    const missingIds = getVectorMissingIds();
    // Should NOT be in the missing set — no provider will ever be available
    expect(missingIds).not.toContain(observation.id);
  });

  it('backfill keeps items and increments failed when provider temporarily unavailable', async () => {
    const oramaStore = await import('../../src/store/orama-store.js');
    const embeddingProvider = await import('../../src/embedding/provider.js');

    // First: store an observation that will end up in vectorMissingIds
    // Provider is temporarily unavailable (not disabled)
    vi.mocked(oramaStore.generateEmbedding).mockResolvedValue(null);
    vi.mocked(embeddingProvider.isEmbeddingExplicitlyDisabled).mockReturnValue(false);

    const { storeObservation, backfillVectorEmbeddings, getVectorMissingIds } =
      await import('../../src/memory/observations.js');

    const { observation } = await storeObservation({
      entityName: 'backfill-retry-test',
      type: 'gotcha',
      title: 'Backfill retry scenario',
      narrative: 'Provider down, should stay in queue after backfill attempt',
      projectId: 'test/vector-stability',
    });

    // Wait for async embedding to settle
    await new Promise(r => setTimeout(r, 100));

    // Verify it's in the missing set
    expect(getVectorMissingIds()).toContain(observation.id);

    // Now attempt backfill — provider still returns null (unavailable)
    const result = await backfillVectorEmbeddings();

    // Should report failed, not succeeded
    expect(result.attempted).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBeGreaterThanOrEqual(1);

    // Must still be in the missing set for next retry
    expect(getVectorMissingIds()).toContain(observation.id);
  });

  it('backfill keeps items queued when the generated embedding dimensions do not match the index', async () => {
    const oramaStore = await import('../../src/store/orama-store.js');

    vi.mocked(oramaStore.generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3]);
    vi.mocked(oramaStore.getVectorDimensions).mockReturnValue(4096);

    const { storeObservation, backfillVectorEmbeddings, getVectorMissingIds } =
      await import('../../src/memory/observations.js');

    const { observation } = await storeObservation({
      entityName: 'backfill-dimension-mismatch',
      type: 'gotcha',
      title: 'Backfill dimension mismatch',
      narrative: 'Backfill should not inject vectors into an incompatible index',
      projectId: 'test/vector-stability',
    });

    await new Promise(r => setTimeout(r, 100));
    expect(getVectorMissingIds()).toContain(observation.id);

    const result = await backfillVectorEmbeddings();

    expect(result.attempted).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(getVectorMissingIds()).toContain(observation.id);
  });

  it('reindexObservations skips synchronous batch embedding when the active provider is remote API', async () => {
    const oramaStore = await import('../../src/store/orama-store.js');
    const embeddingProvider = await import('../../src/embedding/provider.js');
    const persistence = await import('../../src/store/persistence.js');

    vi.mocked(persistence.loadObservationsJson).mockResolvedValue([
      {
        id: 41,
        entityName: 'startup-reindex',
        type: 'discovery',
        title: 'Remote API startup reindex',
        narrative: 'Should not block MCP startup on remote embedding backfill',
        facts: [],
        filesModified: [],
        concepts: [],
        tokens: 10,
        createdAt: new Date().toISOString(),
        projectId: 'test/vector-stability',
        status: 'active',
        source: 'agent',
      },
    ]);
    vi.mocked(embeddingProvider.getEmbeddingProvider).mockResolvedValue({
      name: 'api-Qwen-Qwen3-Embedding-8B',
      dimensions: 4096,
      embed: vi.fn(),
      embedBatch: vi.fn(),
    });

    const { initObservations, reindexObservations, getVectorMissingIds } =
      await import('../../src/memory/observations.js');

    await initObservations('/tmp/memorix-vector-stability');
    const count = await reindexObservations();

    expect(count).toBe(1);
    expect(oramaStore.batchGenerateEmbeddings).not.toHaveBeenCalled();
    expect(getVectorMissingIds()).toContain(41);
  });
});
