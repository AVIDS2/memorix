import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getEmbeddingProvider, resetProvider } from '../../src/embedding/provider.js';

/**
 * Live embedding stress exam: the configured remote embedding lane must
 * survive a 100-text batch, re-init as a singleton, and round-trip its own
 * disk cache. Gated on MEMORIX_RUN_LIVE_EMBEDDING_TESTS=1 — it never runs in
 * CI or without an operator-supplied API key.
 */

const runLive = process.env.MEMORIX_RUN_LIVE_EMBEDDING_TESTS === '1';
const BATCH_SIZE = 100;

describe.skipIf(!runLive)('live embedding stress exam', () => {
  const originalDataDir = process.env.MEMORIX_DATA_DIR;
  let sandbox = '';

  beforeEach(() => {
    sandbox = mkdtempSync(path.join(tmpdir(), 'memorix-live-stress-'));
    process.env.MEMORIX_DATA_DIR = path.join(sandbox, 'data');
    resetProvider();
  });

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.MEMORIX_DATA_DIR;
    else process.env.MEMORIX_DATA_DIR = originalDataDir;
    resetProvider();
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
    sandbox = '';
  });

  it('embeds a 100-text batch with consistent dimensions and caches it', async () => {
    const provider = await getEmbeddingProvider({ requestTimeoutMs: 60_000 });
    expect(provider).not.toBeNull();

    const texts = Array.from({ length: BATCH_SIZE }, (_, i) =>
      `memorix live stress document ${i} about sessions, search, and durable memory`,
    );
    const startedAt = Date.now();
    const vectors = await provider!.embedBatch(texts, { timeoutMs: 60_000 });
    const elapsed = Date.now() - startedAt;

    expect(vectors).toHaveLength(BATCH_SIZE);
    for (const vector of vectors) {
      expect(vector.length, 'every vector must match provider dimensions').toBe(provider!.dimensions);
      expect(vector.some((value) => Number.isFinite(value))).toBe(true);
    }

    // The same inputs must hit the cache on the next pass — no new API calls.
    const cached = await provider!.getCachedEmbeddings?.(texts.slice(0, 20));
    expect(cached?.every((vector) => vector !== null && vector.length === provider!.dimensions)).toBe(true);

    // eslint-disable-next-line no-console
    console.log(`[stress] live embedding: ${BATCH_SIZE} texts in ${elapsed}ms (${provider!.name}, ${provider!.dimensions}d)`);
  }, 180_000);

  it('re-initializes to the same provider instance (singleton stability)', async () => {
    const first = await getEmbeddingProvider({ requestTimeoutMs: 60_000 });
    const second = await getEmbeddingProvider({ requestTimeoutMs: 60_000 });
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(first!.dimensions).toBeGreaterThan(0);
  }, 120_000);
});
