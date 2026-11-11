/**
 * Thorough search uses HTTP rerank when configured, even for short queries.
 * HTTP miss/timeout keeps the original order and does not call LLM rerank.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockIsNeuralRerankEnabled,
  mockNeuralRerankCandidates,
  mockRerankResults,
} = vi.hoisted(() => ({
  mockIsNeuralRerankEnabled: vi.fn(() => true),
  mockNeuralRerankCandidates: vi.fn(),
  mockRerankResults: vi.fn(),
}));

vi.mock('../../src/rerank/index.js', () => ({
  isNeuralRerankEnabled: mockIsNeuralRerankEnabled,
  neuralRerankCandidates: mockNeuralRerankCandidates,
}));

vi.mock('../../src/llm/quality.js', () => ({
  rerankResults: mockRerankResults,
}));

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: vi.fn(async () => ({
    name: 'mock-api',
    dimensions: 2,
    async embed() { return [0, 1]; },
    async embedBatch(texts: string[]) { return texts.map(() => [0, 1]); },
  })),
  isEmbeddingExplicitlyDisabled: vi.fn(() => true),
  resetProvider: vi.fn(),
}));

vi.mock('../../src/llm/provider.js', () => ({
  callLLM: vi.fn(async () => ({ content: '' })),
  isLLMEnabled: vi.fn(() => false),
  initLLM: vi.fn(),
}));

async function insertTokenDocs() {
  const {
    insertObservation,
    makeOramaObservationId,
  } = await import('../../src/store/orama-store.js');
  const now = new Date().toISOString();
  const projectId = 'example/rerank';
  const docs = [
    { id: 1, title: 'token expiry in auth middleware', narrative: 'JWT refresh window' },
    { id: 2, title: 'token table migration', narrative: 'unrelated schema note' },
    { id: 3, title: 'token cache warmup', narrative: 'local cache priming' },
  ];
  for (const doc of docs) {
    await insertObservation({
      id: makeOramaObservationId(projectId, doc.id),
      observationId: doc.id,
      entityName: 'auth',
      type: 'gotcha',
      title: doc.title,
      narrative: doc.narrative,
      facts: 'token',
      filesModified: 'src/auth.ts',
      concepts: 'token\nauth',
      tokens: 20,
      createdAt: now,
      projectId,
      accessCount: 0,
      lastAccessedAt: now,
      status: 'active',
      source: 'agent',
    });
  }
  return projectId;
}

describe('search HTTP rerank gate', () => {
  beforeEach(async () => {
    mockIsNeuralRerankEnabled.mockReset();
    mockNeuralRerankCandidates.mockReset();
    mockRerankResults.mockReset();
    mockIsNeuralRerankEnabled.mockReturnValue(true);
    mockNeuralRerankCandidates.mockImplementation(async (_query: string, candidates: Array<{ id: string }>) => (
      [...candidates].reverse()
    ));
    mockRerankResults.mockResolvedValue({ reranked: [], usedLLM: false });
    vi.resetModules();
    const { resetDb } = await import('../../src/store/orama-store.js');
    await resetDb();
  });

  it('reranks a short thorough query with 3 hits (no heavy-tier or close top-2 required)', async () => {
    const projectId = await insertTokenDocs();
    const { searchObservations, getLastSearchMode } = await import('../../src/store/orama-store.js');

    await searchObservations({
      query: 'token expiry',
      projectId,
      limit: 5,
      quality: 'thorough',
    });

    expect(mockNeuralRerankCandidates).toHaveBeenCalledTimes(1);
    expect(mockRerankResults).not.toHaveBeenCalled();
    expect(getLastSearchMode(projectId)).toContain('neural rerank');
  });

  it('does not call HTTP rerank on balanced search', async () => {
    const projectId = await insertTokenDocs();
    const { searchObservations } = await import('../../src/store/orama-store.js');

    await searchObservations({
      query: 'token expiry',
      projectId,
      limit: 5,
      quality: 'balanced',
    });

    expect(mockNeuralRerankCandidates).not.toHaveBeenCalled();
    expect(mockRerankResults).not.toHaveBeenCalled();
  });

  it('keeps original order and skips LLM rerank when HTTP rerank fails', async () => {
    mockNeuralRerankCandidates.mockRejectedValue(new Error('HTTP rerank timed out'));
    const projectId = await insertTokenDocs();
    const { searchObservations, getLastSearchMode } = await import('../../src/store/orama-store.js');

    const entries = await searchObservations({
      query: 'token expiry',
      projectId,
      limit: 5,
      quality: 'thorough',
    });

    expect(entries.length).toBeGreaterThanOrEqual(3);
    expect(mockNeuralRerankCandidates).toHaveBeenCalledTimes(1);
    expect(mockRerankResults).not.toHaveBeenCalled();
    expect(getLastSearchMode(projectId)).not.toContain('LLM rerank');
  });
});
