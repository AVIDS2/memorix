import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodeGraphStore } from '../../src/codegraph/store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let dir: string | null = null;

function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'memorix-codegraph-store-'));
  return dir;
}

afterEach(() => {
  closeAllDatabases();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('CodeGraphStore', () => {
  it('upserts files, symbols, edges, and refs', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());

    store.upsertFiles([{
      id: 'file:a',
      projectId: 'org/repo',
      path: 'src/auth.ts',
      language: 'typescript',
      contentHash: 'hash-a',
      indexedAt: '2026-06-29T00:00:00.000Z',
    }]);
    store.upsertSymbols([{
      id: 'symbol:a',
      projectId: 'org/repo',
      fileId: 'file:a',
      path: 'src/auth.ts',
      name: 'authMiddleware',
      qualifiedName: 'authMiddleware',
      kind: 'function',
      startLine: 1,
      endLine: 3,
      contentHash: 'sym-a',
      indexedAt: '2026-06-29T00:00:00.000Z',
    }]);
    store.upsertEdges([{
      id: 'edge:a',
      projectId: 'org/repo',
      fromFileId: 'file:a',
      toFileId: 'file:a',
      type: 'references',
      confidence: 1,
      indexedAt: '2026-06-29T00:00:00.000Z',
    }]);
    store.upsertObservationRefs([{
      id: 'coderef:a',
      projectId: 'org/repo',
      observationId: 42,
      fileId: 'file:a',
      symbolId: 'symbol:a',
      capturedFileHash: 'hash-a',
      capturedSymbolHash: 'sym-a',
      status: 'current',
      createdAt: '2026-06-29T00:00:00.000Z',
    }]);

    expect(store.listFiles('org/repo')).toHaveLength(1);
    expect(store.findSymbols('org/repo', 'auth')).toHaveLength(1);
    expect(store.listEdges('org/repo')).toHaveLength(1);
    expect(store.listObservationRefs('org/repo', 42)).toHaveLength(1);
    expect(store.status('org/repo')).toMatchObject({ files: 1, symbols: 1, edges: 1, refs: 1 });
  });

  it('replaces file rows by id', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());

    store.upsertFiles([
      { id: 'file:a', projectId: 'org/repo', path: 'src/a.ts', contentHash: 'old', indexedAt: '2026-06-29T00:00:00.000Z' },
      { id: 'file:a', projectId: 'org/repo', path: 'src/a.ts', contentHash: 'new', indexedAt: '2026-06-29T00:01:00.000Z' },
    ]);

    expect(store.getFile('org/repo', 'src/a.ts')?.contentHash).toBe('new');
  });
});
