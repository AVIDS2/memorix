import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGenerateEmbedding = vi.fn();
const mockInsertObservation = vi.fn();

vi.mock('../../src/store/orama-store.js', () => ({
  insertObservation: mockInsertObservation,
  removeObservation: vi.fn(),
  resetDb: vi.fn(),
  generateEmbedding: mockGenerateEmbedding,
  batchGenerateEmbeddings: vi.fn(),
  getVectorDimensions: vi.fn(() => null),
  hydrateIndex: vi.fn(),
  isEmbeddingEnabled: vi.fn(() => true),
  makeOramaObservationId: vi.fn((projectId: string, observationId: number) => `obs-${projectId}-${observationId}`),
}));

vi.mock('../../src/store/obs-store.js', () => ({
  getObservationStore: vi.fn(),
  initObservationStore: vi.fn(),
}));

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: vi.fn(),
  isEmbeddingExplicitlyDisabled: vi.fn(() => false),
}));

describe('embedding failure logging', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    mockInsertObservation.mockResolvedValue(undefined);
    mockGenerateEmbedding.mockReset();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.useRealTimers();
  });

  it('coalesces repeated invalid-key embedding failures with different request IDs', async () => {
    mockGenerateEmbedding
      .mockRejectedValueOnce(new Error('Embedding API error (401): {"error":{"message":"Incorrect API key provided.","code":"invalid_api_key"},"request_id":"first"}'))
      .mockRejectedValueOnce(new Error('Embedding API error (401): {"error":{"message":"Incorrect API key provided.","code":"invalid_api_key"},"request_id":"second"}'));

    const { storeObservation } = await import('../../src/memory/observations.ts');

    await storeObservation({
      entityName: 'embedding-log',
      type: 'discovery',
      title: 'first',
      narrative: 'first failure',
      projectId: 'test/project',
    });
    await storeObservation({
      entityName: 'embedding-log',
      type: 'discovery',
      title: 'second',
      narrative: 'second failure',
      projectId: 'test/project',
    });

    await vi.runAllTimersAsync();

    const logs = errorSpy.mock.calls.map((call) => call.join(' '));
    expect(logs.filter((line) => line.includes('Async embedding failed'))).toHaveLength(1);
    expect(logs[0]).toContain('invalid API key');
    expect(logs[0]).not.toContain('request_id');
  });
});
