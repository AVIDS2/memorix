import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import {
  closeSemanticIndexes,
  createSemanticIndexProfile,
  deleteSemanticVector,
  ensureSemanticIndex,
  isSemanticIndexAvailable,
  resetSemanticIndexRuntime,
  searchSemanticVectors,
  upsertSemanticVectors,
} from '../../src/search/semantic-index.js';

describe('persistent semantic shadow index', () => {
  let dataDir = '';

  afterEach(async () => {
    await closeSemanticIndexes();
    resetSemanticIndexRuntime();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    dataDir = '';
  });

  it('stores and searches vectors without exposing full documents', async () => {
    if (!(await isSemanticIndexAvailable())) {
      throw new Error('LanceDB is unavailable in the supported Node test environment');
    }
    dataDir = await mkdtemp('E:/tmp-memorix-semantic-');
    const profile = createSemanticIndexProfile({ name: 'test-embedding', dimensions: 3 });

    await upsertSemanticVectors(dataDir, profile, [
      { observationId: 1, projectId: 'project-alpha', status: 'active', vector: [1, 0, 0] },
      { observationId: 2, projectId: 'project-alpha', status: 'active', vector: [0, 1, 0] },
      { observationId: 3, projectId: 'project-beta', status: 'active', vector: [1, 0.1, 0] },
    ]);

    const results = await searchSemanticVectors({
      dataDir,
      profile,
      vector: [1, 0, 0],
      projectId: 'project-alpha',
      status: 'active',
      limit: 10,
    });

    expect(results?.map((result) => result.observationId)).toEqual([1, 2]);
    expect(results?.every((result) => !('title' in result))).toBe(true);

    await deleteSemanticVector(dataDir, profile, 1);
    const afterDelete = await searchSemanticVectors({
      dataDir,
      profile,
      vector: [1, 0, 0],
      projectId: 'project-alpha',
      limit: 10,
    });
    expect(afterDelete?.map((result) => result.observationId)).toEqual([2]);
  });

  it('builds a persistent HNSW/quantized index when the table crosses the threshold', async () => {
    if (!(await isSemanticIndexAvailable())) {
      throw new Error('LanceDB is unavailable in the supported Node test environment');
    }
    dataDir = await mkdtemp('E:/tmp-memorix-semantic-indexed-');
    const previousThreshold = process.env.MEMORIX_SEMANTIC_INDEX_THRESHOLD;
    process.env.MEMORIX_SEMANTIC_INDEX_THRESHOLD = '1';
    try {
      const profile = createSemanticIndexProfile({ name: 'indexed-embedding', dimensions: 3 });
      await upsertSemanticVectors(dataDir, profile, [
        { observationId: 1, projectId: 'project-alpha', status: 'active', vector: [1, 0, 0] },
        { observationId: 2, projectId: 'project-alpha', status: 'active', vector: [0, 1, 0] },
      ]);
      await expect(ensureSemanticIndex(dataDir, profile)).resolves.toBe(true);
      const result = await searchSemanticVectors({ dataDir, profile, vector: [1, 0, 0], limit: 1 });
      expect(result?.[0]?.observationId).toBe(1);
    } finally {
      if (previousThreshold === undefined) delete process.env.MEMORIX_SEMANTIC_INDEX_THRESHOLD;
      else process.env.MEMORIX_SEMANTIC_INDEX_THRESHOLD = previousThreshold;
    }
  });

  it('returns null when the derived table has not been built', async () => {
    if (!(await isSemanticIndexAvailable())) {
      throw new Error('LanceDB is unavailable in the supported Node test environment');
    }
    dataDir = await mkdtemp('E:/tmp-memorix-semantic-empty-');
    const profile = createSemanticIndexProfile({ name: 'empty-embedding', dimensions: 3 });

    await expect(searchSemanticVectors({
      dataDir,
      profile,
      vector: [1, 0, 0],
      limit: 5,
    })).resolves.toBeNull();
  });
});
