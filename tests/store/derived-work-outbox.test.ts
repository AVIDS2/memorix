import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteBackend } from '../../src/store/sqlite-store.js';
import { closeAllDatabases, getDatabase } from '../../src/store/sqlite-db.js';
import { MaintenanceJobStore, MaintenanceJobWorker } from '../../src/runtime/maintenance-jobs.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { resetDb } from '../../src/store/orama-store.js';
import { initObservations, resetObservationRuntime, storeObservation } from '../../src/memory/observations.js';

describe('canonical write derived-work outbox', () => {
  let dataDir = '';
  afterEach(async () => {
    await resetDb();
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

  it('commits claim and qualification jobs with their source observations', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-derived-observation-jobs-'));
    const oldEmbedding = process.env.MEMORIX_EMBEDDING;
    process.env.MEMORIX_EMBEDDING = 'off';
    try {
      await initObservations(dataDir);
      const explicit = await storeObservation({
        projectId: 'org/repo', entityName: 'auth', type: 'decision',
        title: 'Keep explicit evidence', narrative: 'A durable source for claims.',
        source: 'manual', sourceDetail: 'explicit',
        onPersisted: (observation) => {
          const db = getDatabase(dataDir);
          expect(db.prepare('SELECT kind FROM maintenance_jobs WHERE dedupe_key = ?')
            .get(`claim-derive:${observation.id}`)).toEqual({ kind: 'claim-derive' });
        },
      });
      await storeObservation({
        projectId: 'org/repo', entityName: 'capture', type: 'discovery',
        title: 'Review this candidate', narrative: 'Automatic capture.',
        admissionState: 'candidate', sourceDetail: 'hook',
        onPersisted: () => {
          const db = getDatabase(dataDir);
          expect(db.prepare('SELECT kind FROM maintenance_jobs WHERE dedupe_key = ?')
            .get('observation-qualify')).toEqual({ kind: 'observation-qualify' });
        },
      });
      const jobs = new MaintenanceJobStore(dataDir).list({ projectId: 'org/repo' });
      expect(jobs).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'claim-derive', dedupeKey: `claim-derive:${explicit.observation.id}` }),
        expect.objectContaining({ kind: 'observation-qualify', dedupeKey: 'observation-qualify' }),
      ]));
    } finally {
      if (oldEmbedding === undefined) delete process.env.MEMORIX_EMBEDDING;
      else process.env.MEMORIX_EMBEDDING = oldEmbedding;
    }
  });

  it('rolls back the source and derived jobs together when the write fails', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-derived-observation-rollback-'));
    const oldEmbedding = process.env.MEMORIX_EMBEDDING;
    process.env.MEMORIX_EMBEDDING = 'off';
    try {
      await initObservations(dataDir);
      await expect(storeObservation({
        projectId: 'org/repo', entityName: 'auth', type: 'decision',
        title: 'Must roll back', narrative: 'No partial evidence.',
        source: 'manual', sourceDetail: 'explicit', admissionState: 'candidate',
        onPersisted: () => { throw new Error('abort write'); },
      })).rejects.toThrow('abort write');
      const db = (await import('../../src/store/sqlite-db.js')).getDatabase(dataDir);
      expect(db.prepare('SELECT id FROM observations').all()).toEqual([]);
      expect(new MaintenanceJobStore(dataDir).list({ projectId: 'org/repo' })).toEqual([]);
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
