import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backfillMissingObservationCodeRefs, bindObservationToCode } from '../../src/codegraph/binder.js';
import { CodeGraphStore } from '../../src/codegraph/store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let dir: string | null = null;

function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'memorix-codegraph-binder-'));
  return dir;
}

afterEach(() => {
  closeAllDatabases();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('bindObservationToCode', () => {
  it('binds an observation to indexed files and mentioned symbols', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    store.upsertFiles([{
      id: 'file:auth',
      projectId: 'org/repo',
      path: 'src/auth.ts',
      language: 'typescript',
      contentHash: 'file-hash',
      indexedAt: '2026-06-29T00:00:00.000Z',
    }]);
    store.upsertSymbols([{
      id: 'symbol:auth-middleware',
      projectId: 'org/repo',
      fileId: 'file:auth',
      path: 'src/auth.ts',
      name: 'authMiddleware',
      qualifiedName: 'authMiddleware',
      kind: 'function',
      contentHash: 'symbol-hash',
      indexedAt: '2026-06-29T00:00:00.000Z',
    }]);

    const refs = await bindObservationToCode(store, {
      id: 9,
      projectId: 'org/repo',
      title: 'authMiddleware validates JWT',
      narrative: 'The authMiddleware in src/auth.ts calls verifyJwt before allowing access.',
      facts: ['src/auth.ts owns request authentication'],
      filesModified: ['src/auth.ts'],
      createdAt: '2026-06-29T00:01:00.000Z',
    });

    expect(refs).toHaveLength(2);
    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        observationId: 9,
        fileId: 'file:auth',
        capturedFileHash: 'file-hash',
        status: 'current',
      }),
      expect.objectContaining({
        observationId: 9,
        fileId: 'file:auth',
        symbolId: 'symbol:auth-middleware',
        capturedSymbolHash: 'symbol-hash',
        status: 'current',
      }),
    ]));
    expect(store.listObservationRefs('org/repo', 9)).toHaveLength(2);
  });

  it('replaces stale observation bindings when the observation text changes', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    store.upsertFiles([
      {
        id: 'file:auth',
        projectId: 'org/repo',
        path: 'src/auth.ts',
        contentHash: 'auth-hash',
        indexedAt: '2026-06-29T00:00:00.000Z',
      },
      {
        id: 'file:billing',
        projectId: 'org/repo',
        path: 'src/billing.ts',
        contentHash: 'billing-hash',
        indexedAt: '2026-06-29T00:00:00.000Z',
      },
    ]);

    await bindObservationToCode(store, {
      id: 10,
      projectId: 'org/repo',
      title: 'Auth memory',
      narrative: 'Keep this in src/auth.ts.',
      filesModified: ['src/auth.ts'],
      createdAt: '2026-06-29T00:01:00.000Z',
    });
    await bindObservationToCode(store, {
      id: 10,
      projectId: 'org/repo',
      title: 'Billing memory',
      narrative: 'Move this to src/billing.ts.',
      filesModified: ['src/billing.ts'],
      createdAt: '2026-06-29T00:02:00.000Z',
    });

    expect(store.listObservationRefs('org/repo', 10)).toEqual([
      expect.objectContaining({ fileId: 'file:billing' }),
    ]);
  });

  it('backfills only observations that do not already have code refs', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    store.upsertFiles([{
      id: 'file:auth',
      projectId: 'org/repo',
      path: 'src/auth.ts',
      contentHash: 'file-hash',
      indexedAt: '2026-06-29T00:00:00.000Z',
    }]);
    store.upsertObservationRefs([{
      id: 'coderef:existing',
      projectId: 'org/repo',
      observationId: 11,
      fileId: 'file:removed',
      capturedFileHash: 'old-hash',
      status: 'current',
      createdAt: '2026-06-29T00:00:00.000Z',
    }]);

    const result = await backfillMissingObservationCodeRefs(store, [
      {
        id: 11,
        projectId: 'org/repo',
        title: 'Existing stale ref',
        narrative: 'Previously pointed at a removed file.',
        filesModified: ['src/auth.ts'],
        createdAt: '2026-06-29T00:01:00.000Z',
      },
      {
        id: 12,
        projectId: 'org/repo',
        title: 'Needs auth ref',
        narrative: 'Keep this in src/auth.ts.',
        filesModified: ['src/auth.ts'],
        createdAt: '2026-06-29T00:01:00.000Z',
      },
    ]);

    expect(result).toMatchObject({ observationsScanned: 2, observationsBackfilled: 1, refsBackfilled: 1 });
    expect(store.listObservationRefs('org/repo', 11)).toEqual([
      expect.objectContaining({ id: 'coderef:existing', fileId: 'file:removed' }),
    ]);
    expect(store.listObservationRefs('org/repo', 12)).toEqual([
      expect.objectContaining({ fileId: 'file:auth' }),
    ]);
  });
});
