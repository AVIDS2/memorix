import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCacheJsonInWorker } from '../../src/embedding/api-provider.ts';

describe('parseCacheJsonInWorker', () => {
  it('parses a cache file without blocking the event loop', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'memorix-cache-worker-'));
    const filePath = join(dir, '.embedding-api-cache.json');
    const entries: [string, number[]][] = [
      ['abc123', Array.from({ length: 8 }, (_, i) => i + 0.25)],
      ['def456', Array.from({ length: 8 }, (_, i) => i + 0.5)],
    ];
    await writeFile(filePath, JSON.stringify(entries));

    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 5);

    const parsed = await parseCacheJsonInWorker(filePath);
    clearInterval(timer);

    expect(parsed).toEqual(entries);
    expect(ticks).toBeGreaterThan(0);

    await rm(dir, { recursive: true, force: true });
  });
});
