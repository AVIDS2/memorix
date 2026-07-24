import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectCodeStateSnapshot } from '../../src/codegraph/code-state.js';
import { refreshProjectLite } from '../../src/codegraph/lite-provider.js';
import { CodeGraphStore } from '../../src/codegraph/store.js';
import type { CodeStateSnapshotInput } from '../../src/codegraph/types.js';
import { closeAllDatabases, getDatabase } from '../../src/store/sqlite-db.js';

const require = createRequire(import.meta.url);
const BetterSqlite3 = require('better-sqlite3');
let root: string | null = null;

function tempRoot(): string {
  root = mkdtempSync(path.join(tmpdir(), 'memorix-code-state-'));
  return root;
}

function initGitRepository(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'tests@memorix.local'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Memorix Tests'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial fixture'], { cwd: dir, stdio: 'ignore' });
}

function completeness() {
  return {
    scannedFiles: 1,
    maxFiles: 5000,
    changedFiles: 1,
    unchangedFiles: 0,
    metadataOnlyFiles: 0,
    removedFiles: 0,
    skippedOversizedFiles: 0,
    removalScanDeferred: false,
  };
}

function snapshotInput(projectId: string, indexedAt: string): CodeStateSnapshotInput {
  return {
    projectId,
    provider: 'lite',
    baseRevision: 'a'.repeat(40),
    worktreeFingerprint: 'b'.repeat(64),
    worktreeState: 'clean',
    changedPathCount: 0,
    indexedAt,
    completeness: completeness(),
  };
}

afterEach(() => {
  closeAllDatabases();
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe('CodeStateSnapshot', () => {
  it('distinguishes a clean revision from a dirty worktree without copying source', async () => {
    const repo = tempRoot();
    mkdirSync(path.join(repo, 'src'), { recursive: true });
    writeFileSync(path.join(repo, 'src', 'auth.ts'), 'export const auth = true;\n', 'utf8');
    initGitRepository(repo);

    const clean = await collectCodeStateSnapshot({
      projectId: 'org/repo',
      projectRoot: repo,
      provider: 'lite',
      indexedAt: '2026-07-17T00:00:00.000Z',
      completeness: completeness(),
    });
    writeFileSync(path.join(repo, 'src', 'auth.ts'), 'export const auth = false;\n', 'utf8');
    const dirty = await collectCodeStateSnapshot({
      projectId: 'org/repo',
      projectRoot: repo,
      provider: 'lite',
      indexedAt: '2026-07-17T00:01:00.000Z',
      completeness: completeness(),
    });

    expect(clean.worktreeState).toBe('clean');
    expect(clean.changedPathCount).toBe(0);
    expect(clean.baseRevision).toMatch(/^[0-9a-f]{40}$/);
    expect(clean.worktreeFingerprint).toHaveLength(64);
    expect(dirty.worktreeState).toBe('dirty');
    expect(dirty.changedPathCount).toBe(1);
    expect(dirty.worktreeFingerprint).not.toBe(clean.worktreeFingerprint);
  });

  it('reports unavailable rather than pretending a non-Git directory is clean', async () => {
    const repo = tempRoot();
    const state = await collectCodeStateSnapshot({
      projectId: 'org/non-git',
      projectRoot: repo,
      provider: 'lite',
      indexedAt: '2026-07-17T00:00:00.000Z',
      completeness: completeness(),
    });

    expect(state.worktreeState).toBe('unavailable');
    expect(state.changedPathCount).toBe(0);
    expect(state.baseRevision).toBeUndefined();
  });

  it('migrates snapshot columns and records ordered epochs with current fact bindings', async () => {
    const dataDir = tempRoot();
    const db = getDatabase(dataDir);
    const fileColumns = db.prepare('PRAGMA table_info(code_files)').all().map((row: { name: string }) => row.name);
    const migration = db.prepare('SELECT id FROM schema_migrations WHERE id = ?').get('1.2-code-state-snapshots');
    expect(fileColumns).toEqual(expect.arrayContaining(['snapshotId', 'sourceEpoch']));
    expect(migration).toEqual(expect.objectContaining({ id: '1.2-code-state-snapshots' }));

    const store = new CodeGraphStore();
    await store.init(dataDir);
    store.upsertFiles([{
      id: 'file:auth',
      projectId: 'org/repo',
      path: 'src/auth.ts',
      contentHash: 'file-hash',
      indexedAt: '2026-07-17T00:00:00.000Z',
    }]);
    store.upsertSymbols([{
      id: 'symbol:auth',
      projectId: 'org/repo',
      fileId: 'file:auth',
      path: 'src/auth.ts',
      name: 'auth',
      qualifiedName: 'auth',
      kind: 'function',
      contentHash: 'symbol-hash',
      indexedAt: '2026-07-17T00:00:00.000Z',
    }]);
    store.upsertEdges([{
      id: 'edge:auth',
      projectId: 'org/repo',
      fromFileId: 'file:auth',
      type: 'references',
      confidence: 1,
      indexedAt: '2026-07-17T00:00:00.000Z',
    }]);
    store.upsertObservationRefs([{
      id: 'ref:auth',
      projectId: 'org/repo',
      observationId: 1,
      fileId: 'file:auth',
      symbolId: 'symbol:auth',
      status: 'current',
      createdAt: '2026-07-17T00:00:00.000Z',
    }]);

    const first = store.recordCodeStateSnapshot(snapshotInput('org/repo', '2026-07-17T00:00:00.000Z'));
    const second = store.recordCodeStateSnapshot(snapshotInput('org/repo', '2026-07-17T00:01:00.000Z'));

    expect(first.sourceEpoch).toBe(1);
    expect(second.sourceEpoch).toBe(2);
    expect(second.previousSnapshotId).toBe(first.id);
    expect(store.getFile('org/repo', 'src/auth.ts')).toMatchObject({
      snapshotId: second.id,
      sourceEpoch: 2,
      gitCommit: 'a'.repeat(40),
    });
    expect(store.listSymbolsForFile('file:auth')[0]).toMatchObject({
      snapshotId: second.id,
      sourceEpoch: 2,
    });
    expect(store.listEdges('org/repo')[0]).toMatchObject({
      snapshotId: second.id,
      sourceEpoch: 2,
    });
    expect(store.listObservationRefs('org/repo', 1)[0]).toMatchObject({ snapshotId: second.id });
    expect(store.status('org/repo').latestSnapshot).toMatchObject({ id: second.id, sourceEpoch: 2 });
    expect(store.listSnapshots('org/repo')).toHaveLength(2);
  });

  it('upgrades a legacy CodeGraph database without replacing its existing rows', { timeout: 15_000 }, () => {
    const dataDir = tempRoot();
    const legacy = new BetterSqlite3(path.join(dataDir, 'memorix.db'));
    legacy.exec([
      'CREATE TABLE code_files (id TEXT PRIMARY KEY, projectId TEXT NOT NULL, path TEXT NOT NULL, language TEXT, contentHash TEXT NOT NULL, mtimeMs INTEGER, sizeBytes INTEGER, indexedAt TEXT NOT NULL, gitCommit TEXT, UNIQUE(projectId, path));',
      'CREATE TABLE code_symbols (id TEXT PRIMARY KEY, projectId TEXT NOT NULL, fileId TEXT NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL, qualifiedName TEXT NOT NULL, kind TEXT NOT NULL, startLine INTEGER, endLine INTEGER, signature TEXT, contentHash TEXT, indexedAt TEXT NOT NULL, stale INTEGER NOT NULL DEFAULT 0, UNIQUE(projectId, fileId, qualifiedName, kind));',
      'CREATE TABLE code_edges (id TEXT PRIMARY KEY, projectId TEXT NOT NULL, fromSymbolId TEXT, toSymbolId TEXT, fromFileId TEXT, toFileId TEXT, type TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1.0, evidence TEXT, indexedAt TEXT NOT NULL);',
      'CREATE TABLE observation_code_refs (id TEXT PRIMARY KEY, projectId TEXT NOT NULL, observationId INTEGER NOT NULL, fileId TEXT, symbolId TEXT, capturedFileHash TEXT, capturedSymbolHash TEXT, status TEXT NOT NULL, reason TEXT, createdAt TEXT NOT NULL, updatedAt TEXT);',
    ].join('\n'));
    legacy.prepare(
      'INSERT INTO code_files (id, projectId, path, contentHash, indexedAt) VALUES (?, ?, ?, ?, ?)',
    ).run('file:legacy', 'org/repo', 'src/legacy.ts', 'legacy-hash', '2026-07-01T00:00:00.000Z');
    legacy.close();

    const migrated = getDatabase(dataDir);
    const row = migrated.prepare(
      'SELECT path, snapshotId, sourceEpoch FROM code_files WHERE id = ?',
    ).get('file:legacy');
    const refColumns = migrated.prepare('PRAGMA table_info(observation_code_refs)').all()
      .map((column: { name: string }) => column.name);

    expect(row).toMatchObject({ path: 'src/legacy.ts', snapshotId: null, sourceEpoch: null });
    expect(refColumns).toContain('snapshotId');
    expect(migrated.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(
      '1.2-code-state-snapshots',
    )).toEqual(expect.objectContaining({ id: '1.2-code-state-snapshots' }));
  });

  it('creates a new snapshot on each incremental Lite refresh and reports incomplete scans', async () => {
    const sandbox = tempRoot();
    const repo = path.join(sandbox, 'repo');
    const dataDir = path.join(sandbox, 'data');
    mkdirSync(repo, { recursive: true });
    mkdirSync(path.join(repo, 'src'), { recursive: true });
    writeFileSync(path.join(repo, 'src', 'auth.ts'), 'export function auth() { return true; }\n', 'utf8');
    initGitRepository(repo);

    const store = new CodeGraphStore();
    await store.init(dataDir);
    const first = await refreshProjectLite(store, {
      projectId: 'org/repo',
      projectRoot: repo,
      maxFileBytes: 1_024,
    });
    writeFileSync(path.join(repo, 'src', 'auth.ts'), 'export function auth() { return false; }\n', 'utf8');
    writeFileSync(path.join(repo, 'src', 'generated.ts'), 'x'.repeat(2_048), 'utf8');
    const second = await refreshProjectLite(store, {
      projectId: 'org/repo',
      projectRoot: repo,
      maxFileBytes: 1_024,
    });

    expect(first.snapshot).toMatchObject({ sourceEpoch: 1, worktreeState: 'clean' });
    expect(second.snapshot).toMatchObject({
      sourceEpoch: 2,
      previousSnapshotId: first.snapshot.id,
      worktreeState: 'dirty',
    });
    expect(second.snapshot.completeness.skippedOversizedFiles).toBe(1);
    expect(store.status('org/repo').latestSnapshot?.id).toBe(second.snapshot.id);
  });
});
