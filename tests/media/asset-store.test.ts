import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cleanupMediaQuota,
  importMediaBuffer,
  readMediaAsset,
  removeMediaAsset,
} from '../../src/media/asset-store.js';
import { embedMediaAsset, findSimilarMediaAssets } from '../../src/media/embedding.js';
import { MediaStore } from '../../src/media/media-store.js';
import { closeDatabase } from '../../src/store/sqlite-db.js';
import type { EmbeddingProvider } from '../../src/embedding/provider.js';

const roots: Array<{ root: string; dataDir: string }> = [];

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XWZ0AAAAASUVORK5CYII=',
  'base64',
);

async function createFixture(): Promise<{ root: string; dataDir: string; projectId: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'memorix-media-'));
  const dataDir = path.join(root, 'data');
  roots.push({ root, dataDir });
  return { root, dataDir, projectId: 'test/media-project' };
}

afterEach(async () => {
  for (const item of roots.splice(0)) {
    closeDatabase(item.dataDir);
    await rm(item.root, { recursive: true, force: true });
  }
});

describe('controlled media asset store', () => {
  it('deduplicates by content hash while retaining a verified local copy', async () => {
    const fixture = await createFixture();

    const first = await importMediaBuffer({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      bytes: PNG_BYTES,
      filename: 'diagram.png',
      sourceKind: 'import',
    });
    const second = await importMediaBuffer({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      bytes: PNG_BYTES,
      filename: 'renamed-diagram.png',
      sourceKind: 'import',
    });

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.asset.id).toBe(first.asset.id);
    expect(second.asset.sourceLabel).toBe('renamed-diagram.png');
    await expect(readMediaAsset(fixture.dataDir, first.asset)).resolves.toEqual(PNG_BYTES);
  });

  it('never quota-cleans a linked asset and requires force to detach it', async () => {
    const fixture = await createFixture();
    const linked = await importMediaBuffer({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      bytes: PNG_BYTES,
      filename: 'linked.png',
      sourceKind: 'import',
    });
    const unlinked = await importMediaBuffer({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      bytes: Buffer.concat([PNG_BYTES, Buffer.from('different-content')]),
      filename: 'unlinked.png',
      sourceKind: 'import',
    });
    const store = new MediaStore(fixture.dataDir);
    store.linkAsset({
      projectId: fixture.projectId,
      assetId: linked.asset.id,
      role: 'source',
    });

    const cleanup = await cleanupMediaQuota({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      maxBytes: linked.asset.byteSize,
    });
    expect(cleanup.removed.map((asset) => asset.id)).toEqual([unlinked.asset.id]);
    expect(store.getAsset(fixture.projectId, linked.asset.id)).toBeDefined();
    expect(store.getAsset(fixture.projectId, unlinked.asset.id)).toBeUndefined();

    await expect(removeMediaAsset({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      assetId: linked.asset.id,
    })).rejects.toThrow(/attached/i);

    const removed = await removeMediaAsset({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      assetId: linked.asset.id,
      force: true,
    });
    expect(removed.detachedLinks).toBe(1);
    expect(store.getAsset(fixture.projectId, linked.asset.id)).toBeUndefined();
  });

  it('rejects unknown media instead of trusting a filename or caller claim', async () => {
    const fixture = await createFixture();
    await expect(importMediaBuffer({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      bytes: Buffer.from('not a media file'),
      filename: 'looks-like-an-image.png',
      sourceKind: 'import',
    })).rejects.toThrow(/unsupported|unrecognized/i);
  });

  it('does not delete a pre-existing deduplicated file when database registration fails', async () => {
    const fixture = await createFixture();
    const first = await importMediaBuffer({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      bytes: PNG_BYTES,
      filename: 'durable.png',
      sourceKind: 'import',
    });
    const failure = vi.spyOn(MediaStore.prototype, 'createOrReviveAsset')
      .mockImplementationOnce(() => { throw new Error('simulated database failure'); });

    await expect(importMediaBuffer({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      bytes: PNG_BYTES,
      filename: 'same-content.png',
      sourceKind: 'import',
    })).rejects.toThrow('simulated database failure');
    failure.mockRestore();

    await expect(readMediaAsset(fixture.dataDir, first.asset)).resolves.toEqual(PNG_BYTES);
  });

  it('writes media vectors only for declared modality support and searches compatible profiles', async () => {
    const fixture = await createFixture();
    const first = await importMediaBuffer({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      bytes: PNG_BYTES,
      filename: 'first.png',
      sourceKind: 'import',
    });
    const second = await importMediaBuffer({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      bytes: Buffer.concat([PNG_BYTES, Buffer.from('second')]),
      filename: 'second.png',
      sourceKind: 'import',
    });
    const visualProvider: EmbeddingProvider = {
      name: 'test-visual-provider',
      dimensions: 2,
      supportedModalities: ['text', 'image'],
      embed: async () => [1, 0],
      embedBatch: async (texts) => texts.map(() => [1, 0]),
      embedInput: async (input) => {
        if (input.modality !== 'image' || !('data' in input)) throw new Error('unexpected input');
        return Buffer.from(input.data, 'base64').includes(Buffer.from('second')) ? [0.9, 0.1] : [1, 0];
      },
    };

    await expect(embedMediaAsset({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      assetId: first.asset.id,
    }, { provider: visualProvider })).resolves.toMatchObject({ status: 'embedded' });
    await expect(embedMediaAsset({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      assetId: second.asset.id,
    }, { provider: visualProvider })).resolves.toMatchObject({ status: 'embedded' });

    const similar = findSimilarMediaAssets({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      assetId: first.asset.id,
    });
    expect(similar).toHaveLength(1);
    expect(similar[0].asset.id).toBe(second.asset.id);

    const textOnlyProvider: EmbeddingProvider = {
      name: 'test-text-only-provider',
      dimensions: 2,
      supportedModalities: ['text'],
      embed: async () => [1, 0],
      embedBatch: async (texts) => texts.map(() => [1, 0]),
    };
    await expect(embedMediaAsset({
      dataDir: fixture.dataDir,
      projectId: fixture.projectId,
      assetId: first.asset.id,
    }, { provider: textOnlyProvider })).resolves.toMatchObject({ status: 'unsupported' });
  });
});
