import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { attachMediaAssetToObservation } from '../../src/media/attachment.js';
import { importMediaBuffer } from '../../src/media/asset-store.js';
import { MediaStore } from '../../src/media/media-store.js';
import { initObservations } from '../../src/memory/observations.js';
import { getObservationStore, resetObservationStore } from '../../src/store/obs-store.js';
import { closeDatabase } from '../../src/store/sqlite-db.js';

const roots: Array<{ root: string; dataDir: string }> = [];
const originalEmbeddingMode = process.env.MEMORIX_EMBEDDING;
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

async function createFixture(): Promise<{ dataDir: string; projectId: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'memorix-media-attachment-'));
  const dataDir = path.join(root, 'data');
  roots.push({ root, dataDir });
  process.env.MEMORIX_EMBEDDING = 'off';
  await initObservations(dataDir, { embeddingWriteMode: 'deferred' });
  return { dataDir, projectId: 'test/media-attachment' };
}

afterEach(async () => {
  vi.restoreAllMocks();
  resetObservationStore();
  if (originalEmbeddingMode === undefined) delete process.env.MEMORIX_EMBEDDING;
  else process.env.MEMORIX_EMBEDDING = originalEmbeddingMode;
  for (const item of roots.splice(0)) {
    closeDatabase(item.dataDir);
    await rm(item.root, { recursive: true, force: true });
  }
});

describe('media attachment persistence', () => {
  it('commits the observation and its asset link together', async () => {
    const fixture = await createFixture();
    const imported = await importMediaBuffer({
      ...fixture,
      bytes: PNG_BYTES,
      filename: 'diagram.png',
      sourceKind: 'import',
    });

    const observation = await attachMediaAssetToObservation({
      ...fixture,
      asset: imported.asset,
      title: 'Architecture diagram',
    });

    expect(observation.title).toBe('Architecture diagram');
    expect(new MediaStore(fixture.dataDir).listLinks(fixture.projectId, imported.asset.id))
      .toMatchObject([{ observationId: observation.id, role: 'attachment' }]);
  });

  it('rolls back the observation when the asset link cannot be written', async () => {
    const fixture = await createFixture();
    const imported = await importMediaBuffer({
      ...fixture,
      bytes: PNG_BYTES,
      filename: 'rollback.png',
      sourceKind: 'import',
    });
    vi.spyOn(MediaStore.prototype, 'linkAsset').mockImplementationOnce(() => {
      throw new Error('simulated media link failure');
    });

    await expect(attachMediaAssetToObservation({
      ...fixture,
      asset: imported.asset,
      title: 'Must not persist halfway',
    })).rejects.toThrow('simulated media link failure');

    await expect(getObservationStore().loadByProject(fixture.projectId)).resolves.toEqual([]);
    expect(new MediaStore(fixture.dataDir).listLinks(fixture.projectId, imported.asset.id)).toEqual([]);
  });
});
