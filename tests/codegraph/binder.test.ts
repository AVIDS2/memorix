import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('binds mentioned symbols beyond the old broad-search limit', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    store.upsertFiles([{
      id: 'file:symbols',
      projectId: 'org/repo',
      path: 'src/symbols.ts',
      contentHash: 'file-hash',
      indexedAt: '2026-06-29T00:00:00.000Z',
    }]);
    store.upsertSymbols(Array.from({ length: 600 }, (_, index) => ({
      id: `symbol:${index}`,
      projectId: 'org/repo',
      fileId: 'file:symbols',
      path: 'src/symbols.ts',
      name: index === 599 ? 'targetAfterFiveHundred' : `symbol${String(index).padStart(3, '0')}`,
      qualifiedName: index === 599 ? 'targetAfterFiveHundred' : `symbol${String(index).padStart(3, '0')}`,
      kind: 'function' as const,
      startLine: index + 1,
      contentHash: `symbol-hash-${index}`,
      indexedAt: '2026-06-29T00:00:00.000Z',
    })));

    const refs = await bindObservationToCode(store, {
      id: 13,
      projectId: 'org/repo',
      title: 'targetAfterFiveHundred owns the fallback',
      narrative: 'Keep this behavior attached to targetAfterFiveHundred.',
      createdAt: '2026-06-29T00:01:00.000Z',
    });

    expect(refs).toEqual([
      expect.objectContaining({ symbolId: 'symbol:599', fileId: 'file:symbols' }),
    ]);
  });

  it('does not turn ordinary prose words into code symbol refs', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    store.upsertFiles([{
      id: 'file:words',
      projectId: 'org/repo',
      path: 'src/words.ts',
      contentHash: 'file-hash',
      indexedAt: '2026-06-29T00:00:00.000Z',
    }]);
    store.upsertSymbols(['project', 'note'].map((name, index) => ({
      id: `symbol:${name}`,
      projectId: 'org/repo',
      fileId: 'file:words',
      path: 'src/words.ts',
      name,
      qualifiedName: name,
      kind: 'function' as const,
      startLine: index + 1,
      contentHash: `${name}-hash`,
      indexedAt: '2026-06-29T00:00:00.000Z',
    })));

    const refs = await bindObservationToCode(store, {
      id: 14,
      projectId: 'org/repo',
      title: 'General project note',
      narrative: 'This project note records ordinary prose without a code location.',
      createdAt: '2026-06-29T00:01:00.000Z',
    });

    expect(refs).toEqual([]);
  });

  it('does not bind an ambiguous code-shaped symbol without a file hint', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    store.upsertFiles([
      {
        id: 'file:a',
        projectId: 'org/repo',
        path: 'src/a.ts',
        contentHash: 'a-hash',
        indexedAt: '2026-06-29T00:00:00.000Z',
      },
      {
        id: 'file:b',
        projectId: 'org/repo',
        path: 'src/b.ts',
        contentHash: 'b-hash',
        indexedAt: '2026-06-29T00:00:00.000Z',
      },
    ]);
    store.upsertSymbols(['file:a', 'file:b'].map((fileId, index) => ({
      id: `symbol:shared:${index}`,
      projectId: 'org/repo',
      fileId,
      path: index === 0 ? 'src/a.ts' : 'src/b.ts',
      name: 'sharedHandler',
      qualifiedName: 'sharedHandler',
      kind: 'function' as const,
      startLine: 1,
      contentHash: `shared-hash-${index}`,
      indexedAt: '2026-06-29T00:00:00.000Z',
    })));

    const refs = await bindObservationToCode(store, {
      id: 15,
      projectId: 'org/repo',
      title: 'sharedHandler behavior',
      narrative: 'Keep sharedHandler stable without assuming which file owns it.',
      createdAt: '2026-06-29T00:01:00.000Z',
    });

    expect(refs).toEqual([]);
  });

  it('binds a unique PascalCase symbol without a file hint', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    store.upsertFiles([{
      id: 'file:user', projectId: 'org/repo', path: 'src/user.ts', contentHash: 'user-file-hash', indexedAt: '2026-06-29T00:00:00.000Z',
    }]);
    store.upsertSymbols([{
      id: 'symbol:user', projectId: 'org/repo', fileId: 'file:user', path: 'src/user.ts', name: 'User', qualifiedName: 'User', kind: 'class', contentHash: 'user-symbol-hash', indexedAt: '2026-06-29T00:00:00.000Z',
    }]);

    const refs = await bindObservationToCode(store, {
      id: 16, projectId: 'org/repo', title: 'User owns account state', narrative: 'Keep User stable.', createdAt: '2026-06-29T00:01:00.000Z',
    });

    expect(refs).toEqual([expect.objectContaining({ symbolId: 'symbol:user' })]);
  });

  it('binds lowercase symbols when a file hint disambiguates them', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    store.upsertFiles([{
      id: 'file:main', projectId: 'org/repo', path: 'src/main.ts', contentHash: 'main-file-hash', indexedAt: '2026-06-29T00:00:00.000Z',
    }]);
    store.upsertSymbols([{
      id: 'symbol:main', projectId: 'org/repo', fileId: 'file:main', path: 'src/main.ts', name: 'main', qualifiedName: 'main', kind: 'function', contentHash: 'main-symbol-hash', indexedAt: '2026-06-29T00:00:00.000Z',
    }]);

    const refs = await bindObservationToCode(store, {
      id: 17, projectId: 'org/repo', title: 'main starts the app', narrative: 'Update main in src/main.ts.', filesModified: ['src/main.ts'], createdAt: '2026-06-29T00:01:00.000Z',
    });

    expect(refs.some(ref => ref.fileId === 'file:main' && !ref.symbolId)).toBe(true);
    expect(refs.some(ref => ref.symbolId === 'symbol:main')).toBe(true);
  });

  it('binds lowercase symbols written with an explicit call cue', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    store.upsertFiles([{
      id: 'file:run', projectId: 'org/repo', path: 'src/run.ts', contentHash: 'run-file-hash', indexedAt: '2026-06-29T00:00:00.000Z',
    }]);
    store.upsertSymbols([{
      id: 'symbol:run', projectId: 'org/repo', fileId: 'file:run', path: 'src/run.ts', name: 'run', qualifiedName: 'run', kind: 'function', contentHash: 'run-symbol-hash', indexedAt: '2026-06-29T00:00:00.000Z',
    }]);

    const refs = await bindObservationToCode(store, {
      id: 18, projectId: 'org/repo', title: 'run() starts the worker', narrative: 'Keep run() behavior stable.', createdAt: '2026-06-29T00:01:00.000Z',
    });

    expect(refs).toEqual([expect.objectContaining({ symbolId: 'symbol:run' })]);
  });

  it('keeps same-name symbols ambiguous across multiple hinted files', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    store.upsertFiles([
      { id: 'file:a', projectId: 'org/repo', path: 'src/a.ts', contentHash: 'a-hash', indexedAt: '2026-06-29T00:00:00.000Z' },
      { id: 'file:b', projectId: 'org/repo', path: 'src/b.ts', contentHash: 'b-hash', indexedAt: '2026-06-29T00:00:00.000Z' },
    ]);
    store.upsertSymbols(['a', 'b'].map(name => ({
      id: `symbol:${name}`, projectId: 'org/repo', fileId: `file:${name}`, path: `src/${name}.ts`, name: 'sharedHandler', qualifiedName: 'sharedHandler', kind: 'function' as const, contentHash: `${name}-symbol-hash`, indexedAt: '2026-06-29T00:00:00.000Z',
    })));

    const refs = await bindObservationToCode(store, {
      id: 19, projectId: 'org/repo', title: 'sharedHandler changed', narrative: 'Both files changed.', filesModified: ['src/a.ts', 'src/b.ts'], createdAt: '2026-06-29T00:01:00.000Z',
    });

    expect(refs.filter(ref => ref.symbolId)).toEqual([]);
    expect(refs.filter(ref => !ref.symbolId)).toHaveLength(2);
  });

  it('binds Ruby namespace and punctuated method symbols in direct and bulk paths', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    store.upsertFiles([{
      id: 'file:ruby', projectId: 'org/repo', path: 'lib/record.rb', contentHash: 'ruby-file-hash', indexedAt: '2026-06-29T00:00:00.000Z',
    }]);
    store.upsertSymbols(['Foo::Bar', 'save!', 'valid?', 'name='].map((name, index) => ({
      id: `symbol:ruby:${index}`,
      projectId: 'org/repo',
      fileId: 'file:ruby',
      path: 'lib/record.rb',
      name,
      qualifiedName: name,
      kind: index === 0 ? 'class' as const : 'function' as const,
      contentHash: `ruby-symbol-hash-${index}`,
      indexedAt: '2026-06-29T00:00:00.000Z',
    })));
    const observation = {
      projectId: 'org/repo',
      title: 'Foo::Bar keeps save!, valid?, and name= stable',
      narrative: 'The Ruby API relies on Foo::Bar, save!, valid?, and name=.',
      createdAt: '2026-06-29T00:01:00.000Z',
    };

    const direct = await bindObservationToCode(store, { ...observation, id: 20 });
    const bulk = await backfillMissingObservationCodeRefs(store, [{ ...observation, id: 21 }]);

    expect(direct.map(ref => ref.symbolId).filter(Boolean)).toHaveLength(4);
    expect(bulk).toEqual({ observationsScanned: 1, observationsBackfilled: 1, refsBackfilled: 4 });
    expect(store.listObservationRefs('org/repo', 21).map(ref => ref.symbolId).filter(Boolean)).toHaveLength(4);
  });

  it('keeps duplicate symbols ambiguous even when they share one file', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    store.upsertFiles([{
      id: 'file:overloads', projectId: 'org/repo', path: 'src/overloads.ts', contentHash: 'overloads-file-hash', indexedAt: '2026-06-29T00:00:00.000Z',
    }]);
    store.upsertSymbols(['function', 'method'].map((kind, index) => ({
      id: `symbol:duplicate:${index}`,
      projectId: 'org/repo',
      fileId: 'file:overloads',
      path: 'src/overloads.ts',
      name: 'duplicateHandler',
      qualifiedName: index === 0 ? 'duplicateHandler' : 'Service.duplicateHandler',
      kind,
      contentHash: `duplicate-symbol-hash-${index}`,
      indexedAt: '2026-06-29T00:00:00.000Z',
    })));
    const observation = {
      projectId: 'org/repo',
      title: 'duplicateHandler behavior',
      narrative: 'Keep duplicateHandler stable without guessing which declaration applies.',
      createdAt: '2026-06-29T00:01:00.000Z',
    };

    const direct = await bindObservationToCode(store, { ...observation, id: 22 });
    const bulk = await backfillMissingObservationCodeRefs(store, [{ ...observation, id: 23 }]);

    expect(direct).toEqual([]);
    expect(bulk).toEqual({ observationsScanned: 1, observationsBackfilled: 0, refsBackfilled: 0 });
    expect(store.listObservationRefs('org/repo', 23)).toEqual([]);
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

    const perObservationLookup = vi.spyOn(store, 'listObservationRefs');
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
    expect(perObservationLookup).toHaveBeenCalledTimes(2);
  });

  it('does not persist refs for prose-only observations during bulk backfill', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    const replaceRefs = vi.spyOn(store, 'replaceObservationRefs');
    const observations = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      projectId: 'org/repo',
      title: `General project note ${index + 1}`,
      narrative: 'This is ordinary prose without a code identifier or file path.',
      createdAt: '2026-06-29T00:01:00.000Z',
    }));

    const result = await backfillMissingObservationCodeRefs(store, observations);

    expect(result).toEqual({ observationsScanned: 100, observationsBackfilled: 0, refsBackfilled: 0 });
    expect(replaceRefs).not.toHaveBeenCalled();
  });

  it('reuses one project graph snapshot and one write transaction during bulk backfill', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    store.upsertFiles([{
      id: 'file:shared',
      projectId: 'org/repo',
      path: 'src/shared.ts',
      contentHash: 'shared-file-hash',
      indexedAt: '2026-06-29T00:00:00.000Z',
    }]);
    store.upsertSymbols([{
      id: 'symbol:shared-handler',
      projectId: 'org/repo',
      fileId: 'file:shared',
      path: 'src/shared.ts',
      name: 'sharedHandler',
      qualifiedName: 'sharedHandler',
      kind: 'function',
      contentHash: 'shared-symbol-hash',
      indexedAt: '2026-06-29T00:00:00.000Z',
    }]);

    const getFile = vi.spyOn(store, 'getFile');
    const findSymbols = vi.spyOn(store, 'findSymbolsByNames');
    const replaceRefs = vi.spyOn(store, 'replaceObservationRefs');
    const upsertRefs = vi.spyOn(store, 'upsertObservationRefs');
    const observations = Array.from({ length: 50 }, (_, index) => ({
      id: index + 1,
      projectId: 'org/repo',
      title: `sharedHandler behavior ${index + 1}`,
      narrative: 'Keep sharedHandler stable across the project.',
      createdAt: '2026-06-29T00:01:00.000Z',
    }));

    const result = await backfillMissingObservationCodeRefs(store, observations);

    expect(result).toEqual({ observationsScanned: 50, observationsBackfilled: 50, refsBackfilled: 50 });
    expect(getFile).not.toHaveBeenCalled();
    expect(findSymbols).not.toHaveBeenCalled();
    expect(replaceRefs).not.toHaveBeenCalled();
    expect(upsertRefs).toHaveBeenCalledTimes(1);
  });
});
