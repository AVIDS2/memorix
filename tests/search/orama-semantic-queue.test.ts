import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const provider = vi.hoisted(() => ({
  name: 'queue-test-embedding',
  dimensions: 3,
  embed: vi.fn(),
  embedBatch: vi.fn(),
}));

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: vi.fn().mockResolvedValue(provider),
  UnsupportedEmbeddingModalityError: class extends Error {},
}));

import { resetDb, queueSemanticVector } from '../../src/store/orama-store.js';
import {
  closeSemanticIndexes,
  createSemanticIndexProfile,
  getSemanticIndexStats,
  resetSemanticIndexRuntime,
  searchSemanticVectors,
} from '../../src/search/semantic-index.js';

describe('Orama-to-persistent semantic queue bridge', () => {
  let dataDir = '';

  afterEach(async () => {
    await closeSemanticIndexes();
    resetSemanticIndexRuntime();
    await resetDb();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    dataDir = '';
  });

  it('resolves the provider after Orama reset and queues the new vector', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-semantic-queue-'));
    await resetDb();

    await queueSemanticVector(dataDir, {
      observationId: 42,
      projectId: 'queue-project',
      status: 'active',
      vector: [1, 0, 0],
    });

    const result = await searchSemanticVectors({
      dataDir,
      profile: createSemanticIndexProfile(provider),
      vector: [1, 0, 0],
      projectId: 'queue-project',
      limit: 1,
    });
    expect(result?.[0]?.observationId).toBe(42);
  });

  it('batches concurrent observation writes through the Orama bridge', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-semantic-queue-batch-'));
    await Promise.all(Array.from({ length: 25 }, (_, index) => queueSemanticVector(dataDir, {
      observationId: index + 1,
      projectId: 'queue-project',
      status: 'active',
      vector: [1, 0, 0],
    })));

    const stats = await getSemanticIndexStats(dataDir, createSemanticIndexProfile(provider));
    expect(stats?.rowCount).toBe(25);
    expect(stats?.version ?? 99).toBeLessThan(10);
  });
});
