import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteBackend } from '../../src/store/sqlite-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { MaintenanceJobStore, MaintenanceJobWorker } from '../../src/runtime/maintenance-jobs.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { initObservations, resetObservationRuntime, storeObservation } from '../../src/memory/observations.js';

describe('canonical write derived-work outbox', () => {
  let dataDir = '';
  afterEach(async () => {
    resetObservationRuntime();
    resetObservationStore();
    closeAllDatabases();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('commits the observation and its derived vector work together', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-observation-outbox-'));
    const oldEmbedding = process.env.MEMORIX_EMBEDDING;
    process.env.MEMORIX_EMBEDDING = 'api';
    try {
      await initObservations(dataDir, { embeddingWriteMode: 'deferred' });
      const result = await storeObservation({
        projectId: 'org/repo', entityName: 'auth', type: 'decision',
        title: 'Keep stable identifiers', narrative: 'Use one canonical write path.',
      });
      const db = (await import('../../src/store/sqlite-db.js')).getDatabase(dataDir);
      expect(db.prepare('SELECT id FROM observations WHERE id = ?').get(result.observation.id)).toBeDefined();
      expect(new MaintenanceJobStore(dataDir).list({ projectId: 'org/repo' })).toEqual([
        expect.objectContaining({ kind: 'vector-backfill', status: 'pending' }),
      ]);
    } finally {
      if (oldEmbedding === undefined) delete process.env.MEMORIX_EMBEDDING;
      else process.env.MEMORIX_EMBEDDING = oldEmbedding;
    }
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

  it('distinguishes an explicitly completed zero-work job from legacy unknown progress', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-zero-progress-'));
    const store = new MaintenanceJobStore(dataDir);
    const job = store.enqueue({ projectId: 'org/repo', kind: 'vector-backfill' });
    const worker = new MaintenanceJobWorker(store, async () => ({
      action: 'complete' as const,
      progress: { attempted: 0, succeeded: 0, failed: 0, remaining: 0 },
    }), { workerId: 'test-worker' });

    await worker.runOnce();
    expect(store.get(job.id)?.progress).toEqual({ attempted: 0, succeeded: 0, failed: 0, remaining: 0 });
  });

  it('rejects a completed job that still reports outstanding work', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-incomplete-progress-'));
    const store = new MaintenanceJobStore(dataDir);
    const job = store.enqueue({ projectId: 'org/repo', kind: 'vector-backfill' });
    const worker = new MaintenanceJobWorker(store, async () => ({
      action: 'complete' as const,
      progress: { attempted: 1, succeeded: 1, failed: 0, remaining: 2 },
    }), { workerId: 'test-worker' });

    expect((await worker.runOnce()).state).toBe('failed');
    expect(store.get(job.id)?.status).toBe('retry');
  });
});
