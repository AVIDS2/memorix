import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Observation } from '../../src/types.js';
import { SqliteBackend } from '../../src/store/sqlite-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { createSqliteSyncStore } from '../../src/sync/store-port.js';
import { runSync } from '../../src/sync/engine.js';
import { FsRemote } from '../../src/sync/adapters/fs.js';
import { syncNamespace, userSyncNamespace, USER_SYNC_SCOPE_ID } from '../../src/sync/namespace.js';

function observation(id: number, title: string, projectId = 'org/project'): Observation {
  return {
    id,
    entityName: 'sync-test',
    type: 'decision',
    title,
    narrative: title,
    facts: [],
    filesModified: [],
    concepts: [],
    tokens: 1,
    createdAt: new Date().toISOString(),
    projectId,
    status: 'active',
    source: 'manual',
    visibility: 'project',
    admissionState: 'qualified',
  } as Observation;
}

describe('real SQLite multi-device sync', () => {
  let roots: string[] = [];
  const oldFingerprint = process.env.MEMORIX_SYNC_DEVICE_FINGERPRINT;
  const oldUserNamespace = process.env.MEMORIX_SYNC_USER_NAMESPACE;

  beforeEach(() => {
    process.env.MEMORIX_SYNC_USER_NAMESPACE = 'test-user';
  });

  afterEach(async () => {
    closeAllDatabases();
    for (const root of roots) await rm(root, { recursive: true, force: true });
    roots = [];
    if (oldFingerprint === undefined) delete process.env.MEMORIX_SYNC_DEVICE_FINGERPRINT;
    else process.env.MEMORIX_SYNC_DEVICE_FINGERPRINT = oldFingerprint;
    if (oldUserNamespace === undefined) delete process.env.MEMORIX_SYNC_USER_NAMESPACE;
    else process.env.MEMORIX_SYNC_USER_NAMESPACE = oldUserNamespace;
  });

  it('reconciles two real SQLite stores without copying database files', async () => {
    const dataA = await mkdtemp(path.join(os.tmpdir(), 'memorix-sync-sqlite-a-'));
    const dataB = await mkdtemp(path.join(os.tmpdir(), 'memorix-sync-sqlite-b-'));
    const remoteDir = await mkdtemp(path.join(os.tmpdir(), 'memorix-sync-relay-'));
    roots.push(dataA, dataB, remoteDir);

    const storeA = new SqliteBackend();
    const storeB = new SqliteBackend();
    await storeA.init(dataA);
    await storeB.init(dataB);
    await storeA.insert(observation(1, 'from workstation'));

    const namespace = syncNamespace('org/project');
    const remoteA = new FsRemote({ root: remoteDir, namespace });
    const remoteB = new FsRemote({ root: remoteDir, namespace });
    const syncA = createSqliteSyncStore(dataA, storeA, 'org/project');
    const syncB = createSqliteSyncStore(dataB, storeB, 'org/project');

    await runSync(syncA, remoteA, { deviceId: syncA.deviceId(), push: true, pull: false, dryRun: false });
    const report = await runSync(syncB, remoteB, { deviceId: syncB.deviceId(), push: false, pull: true, dryRun: false });

    expect(report.applied).toBe(1);
    expect(await storeB.loadByProject('org/project')).toHaveLength(1);
    expect(await storeB.loadAll()).toHaveLength(1);
    expect(await import('node:fs/promises').then(({ readdir }) => readdir(remoteDir, { recursive: true }))).not.toContain('memorix.db');

    storeA.close();
    storeB.close();
  });

  it('replicates every project under --scope user without copying the database', async () => {
    const dataA = await mkdtemp(path.join(os.tmpdir(), 'memorix-sync-user-a-'));
    const dataB = await mkdtemp(path.join(os.tmpdir(), 'memorix-sync-user-b-'));
    const remoteDir = await mkdtemp(path.join(os.tmpdir(), 'memorix-sync-user-relay-'));
    roots.push(dataA, dataB, remoteDir);

    const storeA = new SqliteBackend();
    const storeB = new SqliteBackend();
    await storeA.init(dataA);
    await storeB.init(dataB);
    await storeA.insert(observation(1, 'from project one', 'org/one'));
    await storeA.insert(observation(2, 'from project two', 'org/two'));
    await storeA.insert({
      ...observation(3, 'stay local', 'org/one'),
      visibility: 'personal',
    });

    const namespace = userSyncNamespace();
    const remoteA = new FsRemote({ root: remoteDir, namespace });
    const remoteB = new FsRemote({ root: remoteDir, namespace });
    const syncA = createSqliteSyncStore(dataA, storeA, USER_SYNC_SCOPE_ID, { scope: 'user' });
    const syncB = createSqliteSyncStore(dataB, storeB, USER_SYNC_SCOPE_ID, { scope: 'user' });

    await runSync(syncA, remoteA, { deviceId: syncA.deviceId(), push: true, pull: false, dryRun: false });
    const report = await runSync(syncB, remoteB, { deviceId: syncB.deviceId(), push: false, pull: true, dryRun: false });

    expect(report.scope).toBe('user');
    expect(report.applied).toBe(2);
    expect(await storeB.loadByProject('org/one')).toHaveLength(1);
    expect(await storeB.loadByProject('org/two')).toHaveLength(1);
    expect(await storeB.loadAll()).toHaveLength(2);

    storeA.close();
    storeB.close();
  });

  it('remaps imported ids when the target already uses the incoming integer id', async () => {
    const dataA = await mkdtemp(path.join(os.tmpdir(), 'memorix-sync-user-collision-a-'));
    const dataB = await mkdtemp(path.join(os.tmpdir(), 'memorix-sync-user-collision-b-'));
    const remoteDir = await mkdtemp(path.join(os.tmpdir(), 'memorix-sync-user-collision-relay-'));
    roots.push(dataA, dataB, remoteDir);

    const storeA = new SqliteBackend();
    const storeB = new SqliteBackend();
    await storeA.init(dataA);
    await storeB.init(dataB);
    await storeA.insert(observation(1, 'remote project row', 'org/remote'));
    await storeB.insert(observation(1, 'local project row', 'org/local'));

    const namespace = userSyncNamespace();
    const remoteA = new FsRemote({ root: remoteDir, namespace });
    const remoteB = new FsRemote({ root: remoteDir, namespace });
    const syncA = createSqliteSyncStore(dataA, storeA, USER_SYNC_SCOPE_ID, { scope: 'user' });
    const syncB = createSqliteSyncStore(dataB, storeB, USER_SYNC_SCOPE_ID, { scope: 'user' });

    await runSync(syncA, remoteA, { deviceId: syncA.deviceId(), push: true, pull: false, dryRun: false });
    const report = await runSync(syncB, remoteB, { deviceId: syncB.deviceId(), push: false, pull: true, dryRun: false });

    expect(report.applied).toBe(1);
    expect(await storeB.getById(1)).toEqual(expect.objectContaining({ projectId: 'org/local', title: 'local project row' }));
    expect(await storeB.loadByProject('org/remote')).toEqual([
      expect.objectContaining({ projectId: 'org/remote', title: 'remote project row', id: 2 }),
    ]);

    storeA.close();
    storeB.close();
  });

  it('applies user-scope tombstones to rows from their source project', async () => {
    const dataA = await mkdtemp(path.join(os.tmpdir(), 'memorix-sync-user-tombstone-a-'));
    const dataB = await mkdtemp(path.join(os.tmpdir(), 'memorix-sync-user-tombstone-b-'));
    const remoteDir = await mkdtemp(path.join(os.tmpdir(), 'memorix-sync-user-tombstone-relay-'));
    roots.push(dataA, dataB, remoteDir);

    const storeA = new SqliteBackend();
    const storeB = new SqliteBackend();
    await storeA.init(dataA);
    await storeB.init(dataB);
    await storeA.insert(observation(1, 'to be removed', 'org/remote'));

    const namespace = userSyncNamespace();
    const syncA = createSqliteSyncStore(dataA, storeA, USER_SYNC_SCOPE_ID, { scope: 'user' });
    const syncB = createSqliteSyncStore(dataB, storeB, USER_SYNC_SCOPE_ID, { scope: 'user' });
    const remoteA = new FsRemote({ root: remoteDir, namespace });
    const remoteB = new FsRemote({ root: remoteDir, namespace });

    await runSync(syncA, remoteA, { deviceId: syncA.deviceId(), push: true, pull: false, dryRun: false });
    await runSync(syncB, remoteB, { deviceId: syncB.deviceId(), push: false, pull: true, dryRun: false });
    expect(await storeB.loadByProject('org/remote')).toHaveLength(1);

    await storeA.remove(1);
    await runSync(syncA, new FsRemote({ root: remoteDir, namespace }), { deviceId: syncA.deviceId(), push: true, pull: false, dryRun: false });
    const report = await runSync(syncB, new FsRemote({ root: remoteDir, namespace }), { deviceId: syncB.deviceId(), push: false, pull: true, dryRun: false });

    expect(report.tombstoned).toBe(1);
    expect(await storeB.loadByProject('org/remote')).toHaveLength(0);

    storeA.close();
    storeB.close();
  });

  it('refuses a copied data directory until the device identity is rotated', async () => {
    const data = await mkdtemp(path.join(os.tmpdir(), 'memorix-sync-clone-'));
    roots.push(data);
    process.env.MEMORIX_SYNC_DEVICE_FINGERPRINT = 'machine-a';
    const store = new SqliteBackend();
    await store.init(data);
    const first = createSqliteSyncStore(data, store, 'org/project');
    const originalDevice = first.deviceId();

    process.env.MEMORIX_SYNC_DEVICE_FINGERPRINT = 'machine-b';
    const cloned = createSqliteSyncStore(data, store, 'org/project');
    expect(() => cloned.assertCanPublish()).toThrow(/device clone detected/);
    const rotated = cloned.rotateDevice();
    expect(rotated).not.toBe(originalDevice);
    expect(() => cloned.assertCanPublish()).not.toThrow();
    store.close();
  });
});
