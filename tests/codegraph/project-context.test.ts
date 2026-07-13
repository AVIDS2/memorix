import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeGraphStore } from '../../src/codegraph/store.js';
import {
  buildProjectContextExplain,
  buildProjectContextOverview,
  formatProjectContextExplain,
  formatProjectContextOverview,
} from '../../src/codegraph/project-context.js';
import type { CodeFile, ObservationCodeRef } from '../../src/codegraph/types.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let dir: string | null = null;

function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'memorix-project-context-'));
  return dir;
}

function makeFile(id: string, path: string): CodeFile {
  return {
    id,
    projectId: 'org/repo',
    path,
    language: path.endsWith('.ts') ? 'typescript' : 'javascript',
    contentHash: `${id}-hash`,
    indexedAt: '2026-06-29T00:00:00.000Z',
  };
}

function makeRef(observationId: number, fileId: string): ObservationCodeRef {
  return {
    id: `ref:${observationId}`,
    projectId: 'org/repo',
    observationId,
    fileId,
    capturedFileHash: `${fileId}-hash`,
    status: 'current',
    createdAt: '2026-06-29T00:01:00.000Z',
  };
}

afterEach(() => {
  closeAllDatabases();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('project context service', () => {
  it('summarizes code memory, languages, active memories, freshness, and reads', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    store.replaceProjectIndex('org/repo', {
      files: [
        {
          id: 'file:auth',
          projectId: 'org/repo',
          path: 'src/auth.ts',
          language: 'typescript',
          contentHash: 'auth-hash',
          indexedAt: '2026-06-29T00:00:00.000Z',
        },
        {
          id: 'file:worker',
          projectId: 'org/repo',
          path: 'src/worker.py',
          language: 'python',
          contentHash: 'worker-hash',
          indexedAt: '2026-06-29T00:00:00.000Z',
        },
      ],
      symbols: [
        {
          id: 'symbol:auth',
          projectId: 'org/repo',
          fileId: 'file:auth',
          path: 'src/auth.ts',
          name: 'authMiddleware',
          qualifiedName: 'authMiddleware',
          kind: 'function',
          startLine: 7,
          contentHash: 'symbol-hash',
          indexedAt: '2026-06-29T00:00:00.000Z',
        },
      ],
      edges: [],
    });
    store.upsertObservationRefs([
      {
        id: 'ref:current',
        projectId: 'org/repo',
        observationId: 1,
        fileId: 'file:auth',
        symbolId: 'symbol:auth',
        capturedFileHash: 'auth-hash',
        capturedSymbolHash: 'symbol-hash',
        status: 'current',
        createdAt: '2026-06-29T00:01:00.000Z',
      },
      {
        id: 'ref:stale',
        projectId: 'org/repo',
        observationId: 2,
        fileId: 'file:deleted',
        capturedFileHash: 'deleted-hash',
        status: 'current',
        createdAt: '2026-06-29T00:01:00.000Z',
      },
    ]);

    const observations = [
      {
        id: 1,
        projectId: 'org/repo',
        title: 'authMiddleware owns JWT validation',
        type: 'decision',
        status: 'active',
        createdAt: '2026-06-29T00:01:00.000Z',
      },
      {
        id: 2,
        projectId: 'org/repo',
        title: 'Old deleted auth file',
        type: 'gotcha',
        status: 'active',
        createdAt: '2026-06-29T00:01:00.000Z',
      },
    ];

    const overview = buildProjectContextOverview({
      project: { id: 'org/repo', name: 'repo', rootPath: 'C:/repo' },
      store,
      observations,
    });
    const text = formatProjectContextOverview(overview);

    expect(overview.code.files).toBe(2);
    expect(overview.code.symbols).toBe(1);
    expect(overview.code.languages).toEqual([
      { language: 'python', files: 1 },
      { language: 'typescript', files: 1 },
    ]);
    expect(overview.memory.active).toBe(2);
    expect(overview.freshness).toMatchObject({ current: 1, stale: 1, suspect: 0 });
    expect(overview.suggestedReads).toEqual(['src/auth.ts']);
    expect(text).toContain('Project context for repo');
    expect(text).toContain('2 code files');
    expect(text).toContain('1 stale memory link');
    expect(text).not.toContain('SQLite');
  });

  it('explains where context came from without exposing secrets or internal storage', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    store.replaceProjectIndex('org/repo', {
      files: [{
        id: 'file:auth',
        projectId: 'org/repo',
        path: 'src/auth.ts',
        language: 'typescript',
        contentHash: 'auth-hash',
        indexedAt: '2026-06-29T00:00:00.000Z',
      }],
      symbols: [],
      edges: [],
    });
    store.upsertObservationRefs([{
      id: 'ref:current',
      projectId: 'org/repo',
      observationId: 1,
      fileId: 'file:auth',
      capturedFileHash: 'auth-hash',
      status: 'current',
      reason: 'bound by file path',
      createdAt: '2026-06-29T00:01:00.000Z',
    }]);

    const listFiles = vi.spyOn(store, 'listFiles');
    const listSymbolsForFile = vi.spyOn(store, 'listSymbolsForFile');
    const listObservationRefs = vi.spyOn(store, 'listObservationRefs');
    const listProjectObservationRefs = vi.spyOn(store, 'listProjectObservationRefs');
    const listReferencedSymbols = vi.spyOn(store, 'listReferencedSymbols');
    const explain = buildProjectContextExplain({
      project: { id: 'org/repo', name: 'repo', rootPath: 'C:/repo' },
      store,
      observations: [{
        id: 1,
        projectId: 'org/repo',
        title: 'Auth decision',
        type: 'decision',
        status: 'active',
        createdAt: '2026-06-29T00:01:00.000Z',
      }],
    });
    const text = formatProjectContextExplain(explain);

    expect(explain.sources).toEqual([
      expect.objectContaining({
        observationId: 1,
        title: 'Auth decision',
        path: 'src/auth.ts',
        status: 'current',
      }),
    ]);
    expect(text).toContain('Context sources for repo');
    expect(text).toContain('#1 decision: Auth decision');
    expect(text).toContain('src/auth.ts');
    expect(text).not.toContain('SQLite');
    expect(listFiles).toHaveBeenCalledTimes(1);
    expect(listProjectObservationRefs).toHaveBeenCalledTimes(1);
    expect(listReferencedSymbols).toHaveBeenCalledTimes(1);
    expect(listSymbolsForFile).not.toHaveBeenCalled();
    expect(listObservationRefs).not.toHaveBeenCalled();
  });

  it('marks refs to removed symbols as stale after reindex', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    const file = makeFile('file:auth', 'src/auth.ts');
    store.replaceProjectIndex('org/repo', {
      files: [file],
      symbols: [{
        id: 'symbol:removed',
        projectId: 'org/repo',
        fileId: file.id,
        path: file.path,
        name: 'removedHandler',
        qualifiedName: 'removedHandler',
        kind: 'function',
        contentHash: 'removed-hash',
        indexedAt: '2026-06-29T00:00:00.000Z',
      }],
      edges: [],
    });
    store.upsertObservationRefs([{
      id: 'ref:removed-symbol',
      projectId: 'org/repo',
      observationId: 1,
      fileId: file.id,
      symbolId: 'symbol:removed',
      capturedFileHash: file.contentHash,
      capturedSymbolHash: 'removed-hash',
      status: 'current',
      createdAt: '2026-06-29T00:01:00.000Z',
    }]);
    store.replaceProjectIndex('org/repo', { files: [file], symbols: [], edges: [] });

    const overview = buildProjectContextOverview({
      project: { id: 'org/repo', name: 'repo', rootPath: 'C:/repo' },
      store,
      observations: [{ id: 1, projectId: 'org/repo', title: 'Removed handler', type: 'gotcha', status: 'active' }],
    });

    expect(overview.freshness).toMatchObject({ current: 0, stale: 1 });
    expect(overview.suggestedReads).toEqual([]);
  });

  it('keeps suggested reads compact and filters generated paths in overview data', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    store.replaceProjectIndex('org/repo', {
      files: [
        makeFile('file:dist', 'dist/auth.js'),
        makeFile('file:runtime-dist', 'packages/agent-core/dist/agent.js'),
        makeFile('file:tmp', '.tmp/release-smoke/cache.ts'),
        makeFile('file:worktree', '.worktrees/release/src/release.ts'),
        makeFile('file:claude-worktree', '.claude/worktrees/release/src/release.ts'),
        makeFile('file:docs', 'docs/notes.md'),
        makeFile('file:auth', 'src/auth.ts'),
        makeFile('file:router', 'src/router.ts'),
        makeFile('file:session', 'src/session.ts'),
        makeFile('file:worker', 'src/worker.ts'),
        makeFile('file:store', 'src/store.ts'),
        makeFile('file:test', 'tests/auth.test.ts'),
        makeFile('file:extra1', 'src/extra1.ts'),
        makeFile('file:extra2', 'src/extra2.ts'),
      ],
      symbols: [],
      edges: [],
    });
    store.upsertObservationRefs([
      makeRef(1, 'file:dist'),
      makeRef(2, 'file:runtime-dist'),
      makeRef(12, 'file:tmp'),
      makeRef(13, 'file:worktree'),
      makeRef(14, 'file:claude-worktree'),
      makeRef(3, 'file:docs'),
      makeRef(4, 'file:auth'),
      makeRef(5, 'file:router'),
      makeRef(6, 'file:session'),
      makeRef(7, 'file:worker'),
      makeRef(8, 'file:store'),
      makeRef(9, 'file:test'),
      makeRef(10, 'file:extra1'),
      makeRef(11, 'file:extra2'),
    ]);

    const observations = Array.from({ length: 14 }, (_, index) => ({
      id: index + 1,
      projectId: 'org/repo',
      title: `Memory ${index + 1}`,
      type: 'decision',
      status: 'active',
      createdAt: '2026-06-29T00:01:00.000Z',
    }));

    const overview = buildProjectContextOverview({
      project: { id: 'org/repo', name: 'repo', rootPath: 'C:/repo' },
      store,
      observations,
    });

    expect(overview.suggestedReads).toHaveLength(8);
    expect(overview.suggestedReads).toEqual([
      'src/auth.ts',
      'src/router.ts',
      'src/session.ts',
      'src/worker.ts',
      'src/store.ts',
      'tests/auth.test.ts',
      'src/extra1.ts',
      'src/extra2.ts',
    ]);
  });

  it('filters user-excluded CodeGraph paths from suggested reads', async () => {
    const store = new CodeGraphStore();
    await store.init(tempDir());
    store.replaceProjectIndex('org/repo', {
      files: [
        makeFile('file:cache', 'vendor/cache/tool.ts'),
        makeFile('file:auth', 'src/auth.ts'),
      ],
      symbols: [],
      edges: [],
    });
    store.upsertObservationRefs([
      makeRef(1, 'file:cache'),
      makeRef(2, 'file:auth'),
    ]);

    const observations = [
      { id: 1, projectId: 'org/repo', title: 'Cache memory', type: 'decision', status: 'active' },
      { id: 2, projectId: 'org/repo', title: 'Auth memory', type: 'decision', status: 'active' },
    ];

    const overview = buildProjectContextOverview({
      project: { id: 'org/repo', name: 'repo', rootPath: 'C:/repo' },
      store,
      observations,
      exclude: ['vendor/**'],
    });
    const explain = buildProjectContextExplain({
      project: { id: 'org/repo', name: 'repo', rootPath: 'C:/repo' },
      store,
      observations,
      exclude: ['vendor/**'],
    });

    expect(overview.suggestedReads).toEqual(['src/auth.ts']);
    expect(overview.freshness.current).toBe(2);
    expect(explain.sources.map(source => source.path)).toEqual(['src/auth.ts']);
  });
});
