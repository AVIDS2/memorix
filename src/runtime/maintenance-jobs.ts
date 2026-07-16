import { randomUUID } from 'node:crypto';

import { getDatabase } from '../store/sqlite-db.js';
import { sanitizeCredentials } from '../memory/secret-filter.js';

export const MAINTENANCE_JOB_KINDS = [
  'vector-backfill',
  'retention-archive',
  'consolidation',
  'codegraph-refresh',
] as const;

export type MaintenanceJobKind = typeof MAINTENANCE_JOB_KINDS[number];
export type MaintenanceJobStatus = 'pending' | 'running' | 'retry' | 'completed' | 'failed';

export interface MaintenanceJob {
  id: string;
  projectId: string;
  kind: MaintenanceJobKind;
  dedupeKey: string;
  payload: Record<string, unknown>;
  status: MaintenanceJobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: number;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface EnqueueMaintenanceJobInput {
  projectId: string;
  kind: MaintenanceJobKind;
  dedupeKey?: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  runAfter?: number;
  now?: number;
}

export interface ClaimMaintenanceJobOptions {
  workerId: string;
  projectId?: string;
  /** Limit this worker to compatible job kinds without claiming other work. */
  kinds?: readonly MaintenanceJobKind[];
  leaseMs?: number;
  now?: number;
}

export interface MaintenanceJobSummary {
  total: number;
  pending: number;
  running: number;
  retrying: number;
  completed: number;
  failed: number;
}

export type MaintenanceJobRunResult =
  | { action: 'complete' }
  | { action: 'reschedule'; delayMs: number; resetAttempts?: boolean; payload?: Record<string, unknown> };

export type MaintenanceJobHandler = (
  job: MaintenanceJob,
) => Promise<MaintenanceJobRunResult | void>;

const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_ERROR_LENGTH = 1_000;
const DEFAULT_COMPLETED_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

function parsePayload(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function rowToJob(row: any): MaintenanceJob {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind as MaintenanceJobKind,
    dedupeKey: row.dedupe_key,
    payload: parsePayload(row.payload_json),
    status: row.status as MaintenanceJobStatus,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    runAfter: Number(row.run_after),
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at != null ? { leaseExpiresAt: Number(row.lease_expires_at) } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    ...(row.completed_at != null ? { completedAt: Number(row.completed_at) } : {}),
  };
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value == null) return fallback;
  return Math.max(1, Math.floor(value));
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return sanitizeCredentials(text).slice(0, MAX_ERROR_LENGTH);
}

function normalizedKinds(kinds: readonly MaintenanceJobKind[] | undefined): MaintenanceJobKind[] | undefined {
  if (!kinds) return undefined;
  return [...new Set(kinds.filter((kind) => MAINTENANCE_JOB_KINDS.includes(kind)))];
}

/** Retry delay grows slowly enough for a local control plane but never spins. */
export function getMaintenanceRetryDelayMs(attempts: number): number {
  return Math.min(60_000, 1_000 * (2 ** Math.max(0, attempts - 1)));
}

/**
 * Persistent queue for work that must never run inside an MCP tool handler.
 * SQLite leases make recovery deterministic when a process exits mid-job.
 */
export class MaintenanceJobStore {
  private readonly db: any;

  constructor(dataDir: string) {
    this.db = getDatabase(dataDir);
  }

  enqueue(input: EnqueueMaintenanceJobInput): MaintenanceJob {
    const now = input.now ?? Date.now();
    const dedupeKey = input.dedupeKey ?? input.kind;
    const runAfter = input.runAfter ?? now;
    const maxAttempts = clampPositiveInteger(input.maxAttempts, DEFAULT_MAX_ATTEMPTS);
    const payloadJson = JSON.stringify(input.payload ?? {});

    this.begin();
    try {
      this.pruneCompletedHistory({ now });
      const existing = this.db.prepare(`
        SELECT * FROM maintenance_jobs
        WHERE project_id = ? AND kind = ? AND dedupe_key = ?
          AND status IN ('pending', 'running', 'retry')
        LIMIT 1
      `).get(input.projectId, input.kind, dedupeKey);

      if (existing) {
        const nextRunAfter = Math.min(Number(existing.run_after), runAfter);
        this.db.prepare(`
          UPDATE maintenance_jobs
          SET payload_json = ?, run_after = ?, updated_at = ?
          WHERE id = ?
        `).run(payloadJson, nextRunAfter, now, existing.id);
        const updated = this.getRow(existing.id)!;
        this.commit();
        return rowToJob(updated);
      }

      const id = randomUUID();
      this.db.prepare(`
        INSERT INTO maintenance_jobs (
          id, project_id, kind, dedupe_key, payload_json, status, attempts,
          max_attempts, run_after, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)
      `).run(id, input.projectId, input.kind, dedupeKey, payloadJson, maxAttempts, runAfter, now, now);
      const created = this.getRow(id)!;
      this.commit();
      return rowToJob(created);
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  get(id: string): MaintenanceJob | undefined {
    const row = this.getRow(id);
    return row ? rowToJob(row) : undefined;
  }

  list(options: { projectId?: string; status?: MaintenanceJobStatus; limit?: number } = {}): MaintenanceJob[] {
    const limit = Math.min(500, clampPositiveInteger(options.limit, 100));
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (options.projectId) {
      clauses.push('project_id = ?');
      values.push(options.projectId);
    }
    if (options.status) {
      clauses.push('status = ?');
      values.push(options.status);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM maintenance_jobs
      ${where}
      ORDER BY run_after ASC, created_at ASC
      LIMIT ?
    `).all(...values, limit);
    return rows.map(rowToJob);
  }

  summary(projectId?: string): MaintenanceJobSummary {
    const row = projectId
      ? this.db.prepare(`
          SELECT
            COUNT(*) AS total,
            SUM(status = 'pending') AS pending,
            SUM(status = 'running') AS running,
            SUM(status = 'retry') AS retrying,
            SUM(status = 'completed') AS completed,
            SUM(status = 'failed') AS failed
          FROM maintenance_jobs WHERE project_id = ?
        `).get(projectId)
      : this.db.prepare(`
          SELECT
            COUNT(*) AS total,
            SUM(status = 'pending') AS pending,
            SUM(status = 'running') AS running,
            SUM(status = 'retry') AS retrying,
            SUM(status = 'completed') AS completed,
            SUM(status = 'failed') AS failed
          FROM maintenance_jobs
        `).get();
    return {
      total: Number(row?.total ?? 0),
      pending: Number(row?.pending ?? 0),
      running: Number(row?.running ?? 0),
      retrying: Number(row?.retrying ?? 0),
      completed: Number(row?.completed ?? 0),
      failed: Number(row?.failed ?? 0),
    };
  }

  /**
   * Completed jobs are useful recent operator history, not permanent data.
   * Failed jobs stay available for diagnosis until an operator explicitly
   * resolves them or clears the database.
   */
  pruneCompletedHistory(options: { now?: number; maxAgeMs?: number } = {}): number {
    const now = options.now ?? Date.now();
    const maxAgeMs = Number.isFinite(options.maxAgeMs)
      ? Math.max(0, Math.floor(options.maxAgeMs!))
      : DEFAULT_COMPLETED_HISTORY_RETENTION_MS;
    const result = this.db.prepare(`
      DELETE FROM maintenance_jobs
      WHERE status = 'completed'
        AND completed_at IS NOT NULL
        AND completed_at < ?
    `).run(now - maxAgeMs);
    return Number(result.changes ?? 0);
  }

  claimNext(options: ClaimMaintenanceJobOptions): MaintenanceJob | undefined {
    const now = options.now ?? Date.now();
    const leaseMs = clampPositiveInteger(options.leaseMs, DEFAULT_LEASE_MS);
    const kinds = normalizedKinds(options.kinds);

    this.begin();
    try {
      // A dead worker leaves a leased row behind. Make it retryable before
      // selecting the next candidate, while respecting its retry budget.
      this.db.prepare(`
        UPDATE maintenance_jobs
        SET
          status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'retry' END,
          run_after = CASE WHEN attempts >= max_attempts THEN run_after ELSE ? END,
          lease_owner = NULL,
          lease_expires_at = NULL,
          last_error = COALESCE(last_error, 'worker lease expired'),
          updated_at = ?
        WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
      `).run(now, now, now);
      this.db.prepare(`
        UPDATE maintenance_jobs
        SET status = 'failed', updated_at = ?
        WHERE status IN ('pending', 'retry') AND attempts >= max_attempts
      `).run(now);

      if (options.kinds && kinds?.length === 0) {
        this.commit();
        return undefined;
      }
      const projectClause = options.projectId ? 'AND project_id = ?' : '';
      const kindClause = kinds?.length
        ? `AND kind IN (${kinds.map(() => '?').join(', ')})`
        : '';
      const values = [
        now,
        ...(kinds ?? []),
        ...(options.projectId ? [options.projectId] : []),
      ];
      const candidate = this.db.prepare(`
        SELECT * FROM maintenance_jobs
        WHERE status IN ('pending', 'retry') AND run_after <= ?
        ${kindClause}
        ${projectClause}
        ORDER BY run_after ASC, created_at ASC
        LIMIT 1
      `).get(...values);

      if (!candidate) {
        this.commit();
        return undefined;
      }

      const leaseExpiresAt = now + leaseMs;
      this.db.prepare(`
        UPDATE maintenance_jobs
        SET status = 'running', attempts = attempts + 1, lease_owner = ?,
            lease_expires_at = ?, updated_at = ?
        WHERE id = ?
      `).run(options.workerId, leaseExpiresAt, now, candidate.id);
      const claimed = this.getRow(candidate.id)!;
      this.commit();
      return rowToJob(claimed);
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  /**
   * Extend a running job's lease. A worker may only renew its own lease, so a
   * stale worker cannot reclaim work that was already recovered elsewhere.
   */
  renewLease(id: string, workerId: string, leaseMs = DEFAULT_LEASE_MS, now = Date.now()): boolean {
    const expiresAt = now + clampPositiveInteger(leaseMs, DEFAULT_LEASE_MS);
    const result = this.db.prepare(`
      UPDATE maintenance_jobs
      SET lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = 'running' AND lease_owner = ?
    `).run(expiresAt, now, id, workerId);
    return Number(result.changes) > 0;
  }

  complete(id: string, workerId: string, now = Date.now()): MaintenanceJob | undefined {
    this.db.prepare(`
      UPDATE maintenance_jobs
      SET status = 'completed', lease_owner = NULL, lease_expires_at = NULL,
          completed_at = ?, updated_at = ?
      WHERE id = ? AND status = 'running' AND lease_owner = ?
    `).run(now, now, id, workerId);
    return this.get(id);
  }

  reschedule(
    id: string,
    workerId: string,
    options: { delayMs: number; resetAttempts?: boolean; payload?: Record<string, unknown>; now?: number },
  ): MaintenanceJob | undefined {
    const now = options.now ?? Date.now();
    const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, Math.floor(options.delayMs)) : 0;
    const payloadJson = options.payload === undefined ? null : JSON.stringify(options.payload);
    this.db.prepare(`
      UPDATE maintenance_jobs
      SET status = 'pending', run_after = ?, attempts = CASE WHEN ? THEN 0 ELSE attempts END,
          payload_json = COALESCE(?, payload_json),
          lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'running' AND lease_owner = ?
    `).run(now + delayMs, options.resetAttempts ? 1 : 0, payloadJson, now, id, workerId);
    return this.get(id);
  }

  fail(id: string, workerId: string, error: unknown, now = Date.now()): MaintenanceJob | undefined {
    this.begin();
    try {
      const current = this.db.prepare(`
        SELECT * FROM maintenance_jobs
        WHERE id = ? AND status = 'running' AND lease_owner = ?
      `).get(id, workerId);
      if (!current) {
        this.commit();
        return undefined;
      }

      const attempts = Number(current.attempts);
      const exhausted = attempts >= Number(current.max_attempts);
      const status: MaintenanceJobStatus = exhausted ? 'failed' : 'retry';
      const runAfter = exhausted ? Number(current.run_after) : now + getMaintenanceRetryDelayMs(attempts);
      this.db.prepare(`
        UPDATE maintenance_jobs
        SET status = ?, run_after = ?, lease_owner = NULL, lease_expires_at = NULL,
            last_error = ?, updated_at = ?
        WHERE id = ?
      `).run(status, runAfter, errorText(error), now, id);
      const updated = this.getRow(id)!;
      this.commit();
      return rowToJob(updated);
    } catch (caught) {
      this.rollback();
      throw caught;
    }
  }

  private getRow(id: string): any {
    return this.db.prepare(`SELECT * FROM maintenance_jobs WHERE id = ?`).get(id);
  }

  private begin(): void {
    this.db.prepare('BEGIN IMMEDIATE').run();
  }

  private commit(): void {
    this.db.prepare('COMMIT').run();
  }

  private rollback(): void {
    try { this.db.prepare('ROLLBACK').run(); } catch { /* transaction already closed */ }
  }
}

export class MaintenanceJobWorker {
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly pollIntervalMs: number;
  private readonly projectId?: string;
  private readonly kinds?: readonly MaintenanceJobKind[];
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly store: MaintenanceJobStore,
    private readonly handler: MaintenanceJobHandler,
    options: {
      workerId?: string;
      leaseMs?: number;
      pollIntervalMs?: number;
      projectId?: string;
      kinds?: readonly MaintenanceJobKind[];
    } = {},
  ) {
    this.workerId = options.workerId ?? `memorix-${process.pid}-${randomUUID().slice(0, 8)}`;
    this.leaseMs = clampPositiveInteger(options.leaseMs, DEFAULT_LEASE_MS);
    this.pollIntervalMs = clampPositiveInteger(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
    this.projectId = options.projectId;
    this.kinds = options.kinds;
  }

  async runOnce(now = Date.now()): Promise<{ state: 'idle' | 'busy' | 'completed' | 'rescheduled' | 'failed'; job?: MaintenanceJob }> {
    if (this.running) return { state: 'busy' };
    this.running = true;
    try {
      const job = this.store.claimNext({
        workerId: this.workerId,
        projectId: this.projectId,
        kinds: this.kinds,
        now,
        leaseMs: this.leaseMs,
      });
      if (!job) return { state: 'idle' };

      const heartbeatMs = Math.max(10, Math.floor(this.leaseMs / 3));
      let leaseLost = false;
      const heartbeat = setInterval(() => {
        try {
          leaseLost = !this.store.renewLease(job.id, this.workerId, this.leaseMs);
        } catch {
          // The next heartbeat can recover from a transient SQLite error. The
          // job itself still has its prior lease until it expires.
        }
      }, heartbeatMs);
      heartbeat.unref?.();

      try {
        const result = await this.handler(job);
        if (leaseLost) {
          return { state: 'failed', job: this.store.get(job.id) };
        }
        if (result?.action === 'reschedule') {
          const updated = this.store.reschedule(job.id, this.workerId, {
            delayMs: result.delayMs,
            resetAttempts: result.resetAttempts,
            payload: result.payload,
            now,
          });
          return { state: 'rescheduled', job: updated };
        }
        const updated = this.store.complete(job.id, this.workerId, now);
        return { state: 'completed', job: updated };
      } catch (error) {
        const updated = this.store.fail(job.id, this.workerId, error, now);
        return { state: 'failed', job: updated };
      } finally {
        clearInterval(heartbeat);
      }
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer) return;
    void this.runOnce().catch(() => {});
    this.timer = setInterval(() => { void this.runOnce().catch(() => {}); }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
