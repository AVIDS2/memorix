import { access, mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureDiskCacheLoaded,
  getApiEmbeddingCachePayloadBytesForTests,
  getApiEmbeddingDiskCacheLoadCountForTests,
  getApiEmbeddingJsonlLineCountCallsForTests,
  getApiEmbeddingMaxEntriesForDimensionsForTests,
  migrateJsonArrayCacheToJsonl,
  resetApiEmbeddingCacheForTests,
  saveDiskCacheNow,
  seedApiEmbeddingCacheForTests,
} from '../../src/embedding/api-provider.ts';

describe('embedding cache jsonl + shrink guard', () => {
  let dir: string;
  let previousDataDir: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'memorix-embed-cache-'));
    previousDataDir = process.env.MEMORIX_DATA_DIR;
    process.env.MEMORIX_DATA_DIR = dir;
    resetApiEmbeddingCacheForTests();
  });

  afterEach(async () => {
    resetApiEmbeddingCacheForTests();
    if (previousDataDir === undefined) delete process.env.MEMORIX_DATA_DIR;
    else process.env.MEMORIX_DATA_DIR = previousDataDir;
    await rm(dir, { recursive: true, force: true });
  });

  it('loads a jsonl cache without JSON.parse of the whole file', async () => {
    const jsonl = join(dir, '.embedding-api-cache.jsonl');
    const lines = [
      JSON.stringify({ h: 'aaa111aaa111aaaa', v: [0.1, 0.2, 0.3] }),
      JSON.stringify({ h: 'bbb222bbb222bbbb', v: [0.4, 0.5, 0.6] }),
    ];
    await writeFile(jsonl, `${lines.join('\n')}\n`);

    const count = await ensureDiskCacheLoaded();
    expect(count).toBe(2);
  });

  it('single-flights concurrent disk cache loads', async () => {
    const jsonl = join(dir, '.embedding-api-cache.jsonl');
    await writeFile(jsonl, `${JSON.stringify({ h: 'aaa111aaa111aaaa', v: [0.1, 0.2] })}\n`);

    const [first, second] = await Promise.all([ensureDiskCacheLoaded(), ensureDiskCacheLoaded()]);

    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(getApiEmbeddingDiskCacheLoadCountForTests()).toBe(1);
  });

  it('refuses to overwrite a larger on-disk cache with a smaller in-memory map', async () => {
    const jsonl = join(dir, '.embedding-api-cache.jsonl');
    const lines = Array.from({ length: 8 }, (_, i) =>
      JSON.stringify({ h: `hash${i.toString().padStart(12, '0')}`, v: [i, i + 0.5] }),
    );
    await writeFile(jsonl, `${lines.join('\n')}\n`);
    const before = await stat(jsonl);

    seedApiEmbeddingCacheForTests(new Map([['only-one', [1, 2, 3]]]));
    await saveDiskCacheNow();

    const after = await stat(jsonl);
    expect(after.size).toBe(before.size);
    const text = await readFile(jsonl, 'utf8');
    expect(text.trim().split('\n')).toHaveLength(8);
  });

  it('narrows tuple and object jsonl rows without treating arrays as {h,v}', async () => {
    const jsonl = join(dir, '.embedding-api-cache.jsonl');
    await writeFile(
      jsonl,
      `${JSON.stringify(['tuplehash0000001', [1, 2, 3]])}\n${JSON.stringify({ h: 'objecthash0000001', v: [4, 5, 6] })}\n`,
    );

    const count = await ensureDiskCacheLoaded();
    expect(count).toBe(2);
  });

  it('does not rescan jsonl on save after a sidecar count exists', async () => {
    const jsonl = join(dir, '.embedding-api-cache.jsonl');
    await writeFile(jsonl, `${JSON.stringify({ h: 'aaa111aaa111aaaa', v: [0.1, 0.2] })}\n`);
    await ensureDiskCacheLoaded();
    const scansAfterLoad = getApiEmbeddingJsonlLineCountCallsForTests();

    seedApiEmbeddingCacheForTests(new Map([
      ['aaa111aaa111aaaa', [0.1, 0.2]],
      ['bbb222bbb222bbbb', [0.3, 0.4]],
    ]));
    await saveDiskCacheNow();
    await saveDiskCacheNow();

    expect(getApiEmbeddingJsonlLineCountCallsForTests()).toBe(scansAfterLoad);
    const text = await readFile(jsonl, 'utf8');
    expect(text.trim().split('\n')).toHaveLength(2);
  });

  it('migrates a JSON array through a temp file and atomic rename', async () => {
    const jsonPath = join(dir, '.embedding-api-cache.json');
    const jsonlPath = join(dir, '.embedding-api-cache.jsonl');
    const entries: [string, number[]][] = [
      ['mig111mig111mig1', [0.2, 0.3, 0.4]],
      ['mig222mig222mig2', [0.5, 0.6, 0.7]],
    ];
    await writeFile(jsonPath, JSON.stringify(entries));

    const count = await migrateJsonArrayCacheToJsonl(jsonPath, jsonlPath);
    expect(count).toBe(2);
    await expect(access(`${jsonlPath}.tmp`)).rejects.toThrow();
    const lines = (await readFile(jsonlPath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ h: 'mig111mig111mig1', v: [0.2, 0.3, 0.4] });
  });

  it('removes the migration temp file when the JSON array is invalid', async () => {
    const jsonPath = join(dir, '.embedding-api-cache.json');
    const jsonlPath = join(dir, '.embedding-api-cache.jsonl');
    await writeFile(jsonPath, '{"not":"an-array"}');

    await expect(migrateJsonArrayCacheToJsonl(jsonPath, jsonlPath)).rejects.toThrow(
      'embedding cache is not a JSON array',
    );
    await expect(access(`${jsonlPath}.tmp`)).rejects.toThrow();
    await expect(access(jsonlPath)).rejects.toThrow();
  });

  it('caps retained vectors by payload bytes, not a 200k entry ceiling', async () => {
    const previousBudget = process.env.MEMORIX_EMBEDDING_CACHE_MAX_BYTES;
    process.env.MEMORIX_EMBEDDING_CACHE_MAX_BYTES = String(3 * 4096 * 8);
    try {
      expect(getApiEmbeddingMaxEntriesForDimensionsForTests(4096)).toBe(3);

      const jsonl = join(dir, '.embedding-api-cache.jsonl');
      const lines = Array.from({ length: 12 }, (_, i) =>
        JSON.stringify({
          h: `dim4k${i.toString().padStart(11, '0')}`,
          v: Array.from({ length: 4096 }, () => i + 0.25),
        }),
      );
      await writeFile(jsonl, `${lines.join('\n')}\n`);

      const loaded = await ensureDiskCacheLoaded();
      expect(loaded).toBeLessThanOrEqual(3);
      expect(getApiEmbeddingCachePayloadBytesForTests()).toBeLessThanOrEqual(3 * 4096 * 8);
    } finally {
      if (previousBudget === undefined) delete process.env.MEMORIX_EMBEDDING_CACHE_MAX_BYTES;
      else process.env.MEMORIX_EMBEDDING_CACHE_MAX_BYTES = previousBudget;
    }
  });
});
