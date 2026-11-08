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
      expect(new MaintenanceJobStore(dataDir).list({ projectId: 'org/repo' })).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'vector-backfill', status: 'pending' }),
        expect.objectContaining({ kind: 'observation-project', status: 'completed' }),
      ]));
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

  it('keeps the projection job pending when the immediate evidence projection fails', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-derived-projection-retry-'));
    const oldEmbedding = process.env.MEMORIX_EMBEDDING;
    process.env.MEMORIX_EMBEDDING = 'off';
    try {
      await initObservations(dataDir);
      const db = getDatabase(dataDir);
      db.exec("CREATE TRIGGER reject_evidence_projection BEFORE INSERT ON evidence_cards BEGIN SELECT RAISE(ABORT, 'projection unavailable'); END");
      const result = await storeObservation({
        projectId: 'org/repo', entityName: 'auth', type: 'decision',
        title: 'Recoverable evidence projection', narrative: 'The canonical row must outlive a projection failure.',
      });
      expect(new MaintenanceJobStore(dataDir).list({ projectId: 'org/repo' })).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'observation-project',
          dedupeKey: `observation-project:${result.observation.id}`,
          status: 'pending',
        }),
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

  it('runs again when a canonical write arrives during an active job', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-rerun-atomic-'));
    const observations = new SqliteBackend();
    await observations.init(dataDir);
    const jobs = new MaintenanceJobStore(dataDir);
    const job = jobs.enqueue({ projectId: 'org/repo', kind: 'vector-backfill' });
    let runs = 0;
    const worker = new MaintenanceJobWorker(jobs, async () => {
      runs++;
      if (runs === 1) {
        await observations.atomic(async (tx) => {
          await tx.enqueueMaintenanceJob!({
            projectId: 'org/repo', kind: 'vector-backfill',
            dedupeKey: 'vector-backfill', payload: { limit: 12 },
          });
        });
      }
      return { action: 'complete' as const, progress: { attempted: 1, succeeded: 1, failed: 0, remaining: 0 } };
    }, { workerId: 'test-worker' });

    expect((await worker.runOnce()).state).toBe('rescheduled');
    expect(jobs.get(job.id)?.status).toBe('pending');
    expect((await worker.runOnce()).state).toBe('completed');
    expect(runs).toBe(2);
    observations.close();
  });

  it('runs again when an ordinary enqueue arrives during an active job', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-rerun-queue-'));
    const jobs = new MaintenanceJobStore(dataDir);
    const job = jobs.enqueue({ projectId: 'org/repo', kind: 'claim-derive', dedupeKey: 'claim-derive:1' });
    let runs = 0;
    const worker = new MaintenanceJobWorker(jobs, async () => {
      if (++runs === 1) jobs.enqueue({ projectId: 'org/repo', kind: 'claim-derive', dedupeKey: 'claim-derive:1' });
      return { action: 'complete' as const };
    }, { workerId: 'test-worker' });

    expect((await worker.runOnce()).state).toBe('rescheduled');
    expect(jobs.get(job.id)?.status).toBe('pending');
    expect((await worker.runOnce()).state).toBe('completed');
    expect(runs).toBe(2);
  });

  it('preserves a new write when the running attempt reaches its retry limit', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-rerun-failed-'));
    const jobs = new MaintenanceJobStore(dataDir);
    const job = jobs.enqueue({ projectId: 'org/repo', kind: 'claim-derive', dedupeKey: 'claim-derive:1', maxAttempts: 1, now: 1_000 });
    const claimed = jobs.claimNext({ workerId: 'test-worker', now: 1_000 });
    expect(claimed?.id).toBe(job.id);
    jobs.enqueue({ projectId: 'org/repo', kind: 'claim-derive', dedupeKey: 'claim-derive:1', now: 1_001 });

    const failed = jobs.fail(job.id, 'test-worker', new Error('transient failure'), 1_002);
    expect(failed?.status).toBe('retry');
    expect(failed?.attempts).toBe(0);
    expect(jobs.claimNext({ workerId: 'next-worker', now: 10_000 })?.id).toBe(job.id);
  });

  it('preserves a new write when its running worker lease expires', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-rerun-lease-'));
    const jobs = new MaintenanceJobStore(dataDir);
    const job = jobs.enqueue({ projectId: 'org/repo', kind: 'claim-derive', dedupeKey: 'claim-derive:1', maxAttempts: 1, now: 1_000 });
    expect(jobs.claimNext({ workerId: 'lost-worker', now: 1_000, leaseMs: 10 })?.id).toBe(job.id);
    jobs.enqueue({ projectId: 'org/repo', kind: 'claim-derive', dedupeKey: 'claim-derive:1', now: 1_001 });

    const recovered = jobs.claimNext({ workerId: 'next-worker', now: 1_100 });
    expect(recovered?.id).toBe(job.id);
    expect(recovered?.status).toBe('running');
    expect(recovered?.attempts).toBe(1);
  });

  it('processes a fresh event before a recurring job enters its long delay', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-rerun-recurring-'));
    const jobs = new MaintenanceJobStore(dataDir);
    const job = jobs.enqueue({ projectId: 'org/repo', kind: 'long-term-maintenance', now: 1_000 });
    let runs = 0;
    const worker = new MaintenanceJobWorker(jobs, async () => {
      if (++runs === 1) jobs.enqueue({ projectId: 'org/repo', kind: 'long-term-maintenance', now: 1_001 });
      return { action: 'reschedule' as const, delayMs: 24 * 60 * 60 * 1_000, resetAttempts: true };
    }, { workerId: 'test-worker' });

    expect((await worker.runOnce(1_000)).state).toBe('rescheduled');
    expect(jobs.get(job.id)?.runAfter).toBeLessThanOrEqual(1_001);
    expect((await worker.runOnce(1_001)).state).toBe('rescheduled');
    expect(runs).toBe(2);
  });
});
