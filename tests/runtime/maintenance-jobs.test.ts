import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  MaintenanceJobStore,
  MaintenanceJobWorker,
} from '../../src/runtime/maintenance-jobs.js';
import { closeAllDatabases, getDatabase, loadBetterSqlite3 } from '../../src/store/sqlite-db.js';

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-maintenance-jobs-'));
});

afterEach(async () => {
  closeAllDatabases();
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('MaintenanceJobStore', () => {
  it('migrates pre-rerun maintenance rows without losing their queued work', () => {
    const Sqlite = loadBetterSqlite3();
    const legacy = new Sqlite(path.join(dataDir, 'memorix.db'));
    legacy.exec(`
      CREATE TABLE maintenance_jobs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL,
        dedupe_key TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 8, run_after INTEGER NOT NULL,
        lease_owner TEXT, lease_expires_at INTEGER, last_error TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER
      );
      INSERT INTO maintenance_jobs
        (id, project_id, kind, dedupe_key, run_after, created_at, updated_at)
      VALUES ('legacy-job', 'project-a', 'vector-backfill', 'vector-backfill', 1000, 1000, 1000);
    `);
    legacy.close();

    const store = new MaintenanceJobStore(dataDir);
    expect(store.get('legacy-job')).toMatchObject({ status: 'pending', attempts: 0 });
    const db = getDatabase(dataDir);
    expect(db.prepare('PRAGMA table_info(maintenance_jobs)').all().map((column: any) => column.name))
      .toContain('rerun_requested');
    expect(store.claimNext({ workerId: 'worker-a', now: 1_000 })?.id).toBe('legacy-job');
  });

  it('deduplicates active work for the same project and key', () => {
    const store = new MaintenanceJobStore(dataDir);
    const first = store.enqueue({
      projectId: 'project-a',
      kind: 'vector-backfill',
      dedupeKey: 'vectors',
      now: 1_000,
    });
    const duplicate = store.enqueue({
      projectId: 'project-a',
      kind: 'vector-backfill',
      dedupeKey: 'vectors',
      now: 2_000,
    });

    expect(duplicate.id).toBe(first.id);
    expect(store.summary('project-a').pending).toBe(1);
  });

  it('leases one job at a time and recovers work after an expired lease', () => {
    const store = new MaintenanceJobStore(dataDir);
    const job = store.enqueue({
      projectId: 'project-a',
      kind: 'vector-backfill',
      dedupeKey: 'vectors',
      now: 1_000,
    });

    const firstClaim = store.claimNext({ workerId: 'worker-a', now: 1_000, leaseMs: 100 });
    expect(firstClaim?.id).toBe(job.id);
    expect(firstClaim?.attempts).toBe(1);
    expect(store.claimNext({ workerId: 'worker-b', now: 1_050, leaseMs: 100 })).toBeUndefined();

    const recovered = store.claimNext({ workerId: 'worker-b', now: 1_101, leaseMs: 100 });
    expect(recovered?.id).toBe(job.id);
    expect(recovered?.attempts).toBe(2);
    expect(recovered?.leaseOwner).toBe('worker-b');
  });

  it('renews an active lease so a long-running job cannot be reclaimed mid-run', () => {
    const store = new MaintenanceJobStore(dataDir);
    const job = store.enqueue({
      projectId: 'project-a',
      kind: 'codegraph-refresh',
      dedupeKey: 'graph',
      now: 1_000,
    });
    const claimed = store.claimNext({ workerId: 'worker-a', now: 1_000, leaseMs: 100 });
    expect(claimed?.id).toBe(job.id);

    expect(store.renewLease(job.id, 'worker-a', 100, 1_050)).toBe(true);
    expect(store.get(job.id)?.leaseExpiresAt).toBe(1_150);
    expect(store.claimNext({ workerId: 'worker-b', now: 1_101, leaseMs: 100 })).toBeUndefined();

    const recovered = store.claimNext({ workerId: 'worker-b', now: 1_151, leaseMs: 100 });
    expect(recovered?.id).toBe(job.id);
    expect(store.renewLease(job.id, 'worker-a', 100, 1_152)).toBe(false);
  });

  it('backs off transient failures and retains the error for operators', () => {
    const store = new MaintenanceJobStore(dataDir);
    const job = store.enqueue({
      projectId: 'project-a',
      kind: 'vector-backfill',
      dedupeKey: 'vectors',
      now: 10_000,
    });
    store.claimNext({ workerId: 'worker-a', now: 10_000, leaseMs: 500 });

    const retried = store.fail(job.id, 'worker-a', new Error('provider unavailable'), 10_100);
    expect(retried?.status).toBe('retry');
    expect(retried?.lastError).toContain('provider unavailable');
    expect(retried?.runAfter).toBeGreaterThan(10_100);
    expect(store.claimNext({ workerId: 'worker-b', now: 10_500, leaseMs: 500 })).toBeUndefined();

    const retriedClaim = store.claimNext({ workerId: 'worker-b', now: retried!.runAfter, leaseMs: 500 });
    expect(retriedClaim?.id).toBe(job.id);
  });

  it('redacts credentials before persisting a maintenance failure for operators', () => {
    const store = new MaintenanceJobStore(dataDir);
    const job = store.enqueue({
      projectId: 'project-a',
      kind: 'vector-backfill',
      now: 1_000,
    });
    store.claimNext({ workerId: 'worker-a', now: 1_000, leaseMs: 500 });

    const failed = store.fail(
      job.id,
      'worker-a',
      new Error('provider rejected api_key=sk-abcdefghijklmnopqrstuvwxyz123456'),
      1_100,
    );

    expect(failed?.lastError).toContain('[REDACTED]');
    expect(failed?.lastError).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
  });

  it('keeps vector recovery in cooldown when another MCP process enqueues the same work', async () => {
    const store = new MaintenanceJobStore(dataDir);
    const job = store.enqueue({
      projectId: 'project-a',
      kind: 'vector-backfill',
      dedupeKey: 'vectors',
      payload: { limit: 12 },
      now: 1_000,
    });
    const worker = new MaintenanceJobWorker(store, async () => ({
      action: 'reschedule' as const,
      status: 'retry' as const,
      delayMs: 60_000,
      resetAttempts: true,
      payload: { limit: 12, vectorBackfillFailureStreak: 1 },
      lastError: 'provider unavailable',
    }), { workerId: 'vector-worker', leaseMs: 100 });

    await worker.runOnce(1_000);
    const cooled = store.get(job.id)!;
    const duplicate = store.enqueue({
      projectId: 'project-a',
      kind: 'vector-backfill',
      dedupeKey: 'vectors',
      payload: { limit: 12 },
      now: 2_000,
    });

    expect(cooled).toMatchObject({
      status: 'retry',
      attempts: 0,
      lastError: 'provider unavailable',
      payload: { limit: 12, vectorBackfillFailureStreak: 1 },
    });
    expect(duplicate).toMatchObject({
      id: job.id,
      status: 'retry',
      runAfter: cooled.runAfter,
      payload: { limit: 12, vectorBackfillFailureStreak: 1 },
    });
  });

  it('revives one failed vector backfill instead of adding another failed row', () => {
    const store = new MaintenanceJobStore(dataDir);
    const job = store.enqueue({
      projectId: 'project-a',
      kind: 'vector-backfill',
      dedupeKey: 'vectors',
      maxAttempts: 1,
      now: 1_000,
    });
    store.claimNext({ workerId: 'worker-a', now: 1_000, leaseMs: 100 });
    expect(store.fail(job.id, 'worker-a', new Error('old transient failure'), 1_100)?.status).toBe('failed');

    const revived = store.enqueue({
      projectId: 'project-a',
      kind: 'vector-backfill',
      dedupeKey: 'vectors',
      payload: { limit: 12 },
      now: 2_000,
    });

    expect(revived).toMatchObject({
      id: job.id,
      status: 'pending',
      attempts: 0,
      payload: { limit: 12 },
    });
    expect(revived.lastError).toBeUndefined();
  });

  it('resolves historical vector failures after a later backfill completes', () => {
    const store = new MaintenanceJobStore(dataDir);
    const failed = store.enqueue({
      projectId: 'project-a',
      kind: 'vector-backfill',
      dedupeKey: 'vectors',
      maxAttempts: 1,
      now: 1_000,
    });
    store.claimNext({ workerId: 'worker-a', now: 1_000, leaseMs: 100 });
    expect(store.fail(failed.id, 'worker-a', new Error('old provider failure'), 1_100)?.status).toBe('failed');

    const unrelated = store.enqueue({
      projectId: 'project-b',
      kind: 'vector-backfill',
      dedupeKey: 'vectors',
      maxAttempts: 1,
      now: 1_000,
    });
    store.claimNext({ workerId: 'worker-b', now: 1_000, leaseMs: 100 });
    expect(store.fail(unrelated.id, 'worker-b', new Error('other project failure'), 1_100)?.status).toBe('failed');

    expect(store.resolveFailedVectorBackfills('project-a', 'vectors', 2_000)).toBe(1);
    expect(store.get(failed.id)).toMatchObject({ status: 'completed', completedAt: 2_000 });
    expect(store.get(unrelated.id)?.status).toBe('failed');
  });

  it('prunes completed history after its retention window without deleting failed diagnostics', () => {
    const store = new MaintenanceJobStore(dataDir);
    const completed = store.enqueue({
      projectId: 'project-a',
      kind: 'retention-archive',
      now: 1_000,
    });
    store.claimNext({ workerId: 'worker-a', now: 1_000, leaseMs: 500 });
    store.complete(completed.id, 'worker-a', 2_000);

    const failed = store.enqueue({
      projectId: 'project-a',
      kind: 'codegraph-refresh',
      now: 1_000,
      maxAttempts: 1,
    });
    store.claimNext({ workerId: 'worker-b', now: 1_000, leaseMs: 500 });
    store.fail(failed.id, 'worker-b', new Error('scan failed'), 2_000);

    const pruned = store.pruneCompletedHistory({ now: 8 * 24 * 60 * 60 * 1_000 });

    expect(pruned).toBe(1);
    expect(store.get(completed.id)).toBeUndefined();
    expect(store.get(failed.id)?.status).toBe('failed');
  });

  it('prunes failed diagnostics after their longer retention window', () => {
    const store = new MaintenanceJobStore(dataDir);
    const failed = store.enqueue({
      projectId: 'project-a',
      kind: 'codegraph-refresh',
      now: 1_000,
      maxAttempts: 1,
    });
    store.claimNext({ workerId: 'worker-a', now: 1_000, leaseMs: 500 });
    store.fail(failed.id, 'worker-a', new Error('old failure'), 2_000);

    const retained = store.pruneCompletedHistory({
      now: 20 * 24 * 60 * 60 * 1_000,
      failedMaxAgeMs: 30 * 24 * 60 * 60 * 1_000,
    });
    expect(retained).toBe(0);
    expect(store.get(failed.id)?.status).toBe('failed');

    const pruned = store.pruneCompletedHistory({
      now: 31 * 24 * 60 * 60 * 1_000,
      failedMaxAgeMs: 30 * 24 * 60 * 60 * 1_000,
    });
    expect(pruned).toBe(1);
    expect(store.get(failed.id)).toBeUndefined();
  });

  it('does not prune completed history when enqueue cannot begin its transaction', () => {
    const store = new MaintenanceJobStore(dataDir);
    const completed = store.enqueue({
      projectId: 'project-a',
      kind: 'retention-archive',
      now: 1_000,
    });
    store.claimNext({ workerId: 'worker-a', now: 1_000, leaseMs: 500 });
    store.complete(completed.id, 'worker-a', 2_000);

    const begin = vi.spyOn(store as any, 'begin').mockImplementationOnce(() => {
      throw new Error('database busy');
    });

    expect(() => store.enqueue({
      projectId: 'project-a',
      kind: 'codegraph-refresh',
      now: 8 * 24 * 60 * 60 * 1_000,
    })).toThrow('database busy');
    expect(store.get(completed.id)?.status).toBe('completed');

    begin.mockRestore();
  });
});

describe('MaintenanceJobWorker', () => {
  it.each([
    ['negative', { attempted: -1, succeeded: 0, failed: 0, remaining: 0 }],
    ['fractional', { attempted: 1.5, succeeded: 1, failed: 0, remaining: 0 }],
    ['non-finite', { attempted: 1, succeeded: 1, failed: 0, remaining: Number.NaN }],
    ['inconsistent', { attempted: 1, succeeded: 2, failed: 0, remaining: 0 }],
  ])('rejects %s progress before marking a job complete', async (_name, progress) => {
    const store = new MaintenanceJobStore(dataDir);
    const job = store.enqueue({ projectId: 'project-a', kind: 'vector-backfill', now: 1_000 });
    const worker = new MaintenanceJobWorker(store, async () => ({
      action: 'complete' as const,
      progress,
    }), { workerId: 'test-worker' });

    expect((await worker.runOnce(1_000)).state).toBe('failed');
    expect(store.get(job.id)).toMatchObject({ status: 'retry', lastError: expect.stringContaining('progress') });
    expect(store.get(job.id)?.progress).toBeUndefined();
  });

  it('rejects incoherent progress on a rescheduled job', async () => {
    const store = new MaintenanceJobStore(dataDir);
    const job = store.enqueue({ projectId: 'project-a', kind: 'vector-backfill', now: 1_000 });
    const worker = new MaintenanceJobWorker(store, async () => ({
      action: 'reschedule' as const,
      delayMs: 1_000,
      progress: { attempted: 1, succeeded: 1, failed: 1, remaining: 0 },
    }), { workerId: 'test-worker' });

    expect((await worker.runOnce(1_000)).state).toBe('failed');
    expect(store.get(job.id)?.progress).toBeUndefined();
  });

  it('reschedules incremental work without treating successful progress as a failure', async () => {
    const store = new MaintenanceJobStore(dataDir);
    const job = store.enqueue({
      projectId: 'project-a',
      kind: 'vector-backfill',
      dedupeKey: 'vectors',
      now: 1_000,
    });
    let calls = 0;
    const worker = new MaintenanceJobWorker(store, async () => {
      calls++;
      return calls === 1
        ? { action: 'reschedule' as const, delayMs: 0, resetAttempts: true }
        : { action: 'complete' as const };
    }, { workerId: 'test-worker', leaseMs: 100 });

    await worker.runOnce(1_000);
    expect(store.get(job.id)?.status).toBe('pending');
    expect(store.get(job.id)?.attempts).toBe(0);

    await worker.runOnce(1_001);
    expect(store.get(job.id)?.status).toBe('completed');
    expect(calls).toBe(2);
  });

  it('persists a replacement payload when a bounded job advances its cursor', async () => {
    const store = new MaintenanceJobStore(dataDir);
    const job = store.enqueue({
      projectId: 'project-a',
      kind: 'retention-archive',
      dedupeKey: 'retention',
      payload: { cursor: 0, limit: 100 },
      now: 1_000,
    });
    const worker = new MaintenanceJobWorker(store, async () => ({
      action: 'reschedule' as const,
      delayMs: 0,
      resetAttempts: true,
      payload: { cursor: 100, limit: 100 },
    }), { workerId: 'cursor-worker', leaseMs: 100 });

    await worker.runOnce(1_000);

    expect(store.get(job.id)).toMatchObject({
      status: 'pending',
      attempts: 0,
      payload: { cursor: 100, limit: 100 },
    });
  });

  it('keeps a lease alive while an asynchronous handler is still running', async () => {
    const store = new MaintenanceJobStore(dataDir);
    const job = store.enqueue({
      projectId: 'project-a',
      kind: 'codegraph-refresh',
      dedupeKey: 'graph',
      now: Date.now(),
    });
    let competingClaim: unknown;
    const worker = new MaintenanceJobWorker(store, async () => {
      await new Promise((resolve) => setTimeout(resolve, 140));
      competingClaim = store.claimNext({ workerId: 'worker-b', now: Date.now(), leaseMs: 100 });
      return { action: 'complete' as const };
    }, { workerId: 'worker-a', leaseMs: 100 });

    await worker.runOnce(Date.now());

    expect(competingClaim).toBeUndefined();
    expect(store.get(job.id)?.status).toBe('completed');
  });

  it('claims ready work immediately when the worker starts', async () => {
    const store = new MaintenanceJobStore(dataDir);
    const job = store.enqueue({
      projectId: 'project-a',
      kind: 'retention-archive',
      now: Date.now(),
    });
    let finishHandler: (() => void) | undefined;
    const handled = new Promise<void>((resolve) => { finishHandler = resolve; });
    const worker = new MaintenanceJobWorker(store, async () => {
      finishHandler?.();
      return { action: 'complete' as const };
    }, { workerId: 'immediate-worker', pollIntervalMs: 60_000 });

    worker.start();
    await handled;
    worker.stop();

    expect(store.get(job.id)?.status).toBe('completed');
  });
});
