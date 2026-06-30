import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeGraphStore } from '../../src/codegraph/store.js';
import { initObservations, storeObservation } from '../../src/memory/observations.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { initObservationStore, resetObservationStore } from '../../src/store/obs-store.js';
import { resetDb } from '../../src/store/orama-store.js';

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: async () => null,
  isVectorSearchAvailable: async () => false,
  isEmbeddingExplicitlyDisabled: () => true,
  resetProvider: () => {},
}));

let dir: string | null = null;

function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'memorix-codegraph-integration-'));
  return dir;
}

afterEach(async () => {
  resetObservationStore();
  await resetDb();
  closeAllDatabases();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('observation code refs integration', () => {
  it('stores code refs after an observation references indexed code', async () => {
    const dataDir = tempDir();
    await initObservationStore(dataDir);
    await initObservations(dataDir);
    const codeStore = new CodeGraphStore();
    await codeStore.init(dataDir);
    codeStore.upsertFiles([{
      id: 'file:auth',
      projectId: 'org/repo',
      path: 'src/auth.ts',
      contentHash: 'filehash',
      indexedAt: '2026-06-29T00:00:00.000Z',
    }]);
    codeStore.upsertSymbols([{
      id: 'symbol:auth',
      projectId: 'org/repo',
      fileId: 'file:auth',
      path: 'src/auth.ts',
      name: 'authMiddleware',
      qualifiedName: 'authMiddleware',
      kind: 'function',
      contentHash: 'symhash',
      indexedAt: '2026-06-29T00:00:00.000Z',
    }]);

    const result = await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'authMiddleware uses jose',
      narrative: 'Keep authMiddleware in src/auth.ts.',
      filesModified: ['src/auth.ts'],
      projectId: 'org/repo',
    });

    const refs = codeStore.listObservationRefs('org/repo', result.observation.id);
    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fileId: 'file:auth',
        symbolId: 'symbol:auth',
        capturedFileHash: 'filehash',
        capturedSymbolHash: 'symhash',
        status: 'current',
      }),
    ]));
  });
});
