import { afterEach, describe, expect, it } from 'vitest';
import { getEmbeddingProvider, resetProvider } from '../../src/embedding/provider.js';

const runLive = process.env.MEMORIX_RUN_LIVE_EMBEDDING_TESTS === '1';

describe.skipIf(!runLive)('live embedding provider', () => {
  afterEach(() => {
    resetProvider();
  });

  it('returns one compatible vector for each batch input', async () => {
    const provider = await getEmbeddingProvider();
    expect(provider).not.toBeNull();

    const vectors = await provider!.embedBatch([
      'memorix live batch smoke alpha',
      'memorix live batch smoke beta',
    ]);

    expect(vectors).toHaveLength(2);
    expect(vectors.every((vector) => vector.length === provider!.dimensions)).toBe(true);
  }, 60_000);
});
