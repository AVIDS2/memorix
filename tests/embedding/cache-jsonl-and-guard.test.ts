import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureDiskCacheLoaded,
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
});
