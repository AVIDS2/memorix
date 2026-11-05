import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteBackend } from '../../src/store/sqlite-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { MaintenanceJobStore, MaintenanceJobWorker } from '../../src/runtime/maintenance-jobs.js';

describe('canonical write derived-work outbox', () => {
  let dataDir = '';
  afterEach(async () => {
    closeAllDatabases();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('enqueues derived work inside the same SQLite transaction', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-derived-outbox-'));
    const store = new SqliteBackend();
    await store.init(dataDir);
    await store.atomic(async (tx) => {
      await tx.enqueueMaintenanceJob({
        projectId: 'org/repo',
        kind: 'vector-backfill',
        dedupeKey: 'vector-backfill',
        payload: { limit: 12 },
      });
    });

    const db = (await import('../../src/store/sqlite-db.js')).getDatabase(dataDir);
    expect(db.prepare('SELECT project_id, kind, status FROM maintenance_jobs').all()).toEqual([
      { project_id: 'org/repo', kind: 'vector-backfill', status: 'pending' },
    ]);
    store.close();
  });

  it('persists maintenance progress instead of only a lifecycle status', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-maintenance-progress-'));
    const store = new MaintenanceJobStore(dataDir);
    const job = store.enqueue({ projectId: 'org/repo', kind: 'vector-backfill' });
    const worker = new MaintenanceJobWorker(store, async () => ({
      action: 'reschedule' as const,
      delayMs: 1000,
      progress: { attempted: 12, succeeded: 9, failed: 3, remaining: 4 },
    }), { workerId: 'test-worker' });

    await worker.runOnce();
    expect(store.get(job.id)?.progress).toEqual({ attempted: 12, succeeded: 9, failed: 3, remaining: 4 });
  });
});
