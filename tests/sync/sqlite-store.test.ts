import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Observation } from '../../src/types.js';
import { SqliteBackend } from '../../src/store/sqlite-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { createSqliteSyncStore } from '../../src/sync/store-port.js';
import { runSync } from '../../src/sync/engine.js';
import { FsRemote } from '../../src/sync/adapters/fs.js';
import { syncNamespace } from '../../src/sync/namespace.js';

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

  afterEach(async () => {
    closeAllDatabases();
    for (const root of roots) await rm(root, { recursive: true, force: true });
    roots = [];
    if (oldFingerprint === undefined) delete process.env.MEMORIX_SYNC_DEVICE_FINGERPRINT;
    else process.env.MEMORIX_SYNC_DEVICE_FINGERPRINT = oldFingerprint;
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
