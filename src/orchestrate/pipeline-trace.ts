/**
 * Pipeline Tracing — Phase 6g: Structured event logging.
 *
 * Writes trace events to SQLite for observability and debugging.
 * Built-in pruning retains only the last N pipelines (pays D9 debt).
 */

import type Database from 'better-sqlite3';

// ── Types ──────────────────────────────────────────────────────────

export type TraceEventType =
  | 'plan' | 'materialize' | 'dispatch' | 'complete' | 'fail'
  | 'retry' | 'timeout' | 'stale' | 'replan' | 'worktree:create'
  | 'worktree:merge' | 'worktree:cleanup' | 'pipeline:start' | 'pipeline:end';

export interface TraceEvent {
  pipelineId: string;
  timestamp: number;
  type: TraceEventType;
  taskId?: string;
  agent?: string;
  detail: string;
  durationMs?: number;
}

// ── Schema ─────────────────────────────────────────────────────────

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS pipeline_traces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    type TEXT NOT NULL,
    task_id TEXT,
    agent TEXT,
    detail TEXT NOT NULL,
    duration_ms INTEGER
  )
`;

const CREATE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_pipeline_traces_pipeline
  ON pipeline_traces (pipeline_id, timestamp)
`;

// ── Init ───────────────────────────────────────────────────────────

export function initTraceTable(db: Database.Database): void {
  db.exec(CREATE_TABLE_SQL);
  db.exec(CREATE_INDEX_SQL);
}

// ── Write ──────────────────────────────────────────────────────────

let _insertStmt: Database.Statement | null = null;

export function writeTrace(db: Database.Database, event: TraceEvent): void {
  if (!_insertStmt) {
    _insertStmt = db.prepare(`
      INSERT INTO pipeline_traces (pipeline_id, timestamp, type, task_id, agent, detail, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
  }
  _insertStmt.run(
    event.pipelineId,
    event.timestamp,
    event.type,
    event.taskId ?? null,
    event.agent ?? null,
    event.detail,
    event.durationMs ?? null,
  );
}

// ── Read ───────────────────────────────────────────────────────────

export function getTraces(db: Database.Database, pipelineId: string): TraceEvent[] {
  const rows = db.prepare(
    'SELECT * FROM pipeline_traces WHERE pipeline_id = ? ORDER BY timestamp ASC',
  ).all(pipelineId) as Array<{
    pipeline_id: string; timestamp: number; type: string;
    task_id: string | null; agent: string | null; detail: string;
    duration_ms: number | null;
  }>;

  return rows.map(r => ({
    pipelineId: r.pipeline_id,
    timestamp: r.timestamp,
    type: r.type as TraceEventType,
    taskId: r.task_id ?? undefined,
    agent: r.agent ?? undefined,
    detail: r.detail,
    durationMs: r.duration_ms ?? undefined,
  }));
}

// ── Prune ──────────────────────────────────────────────────────────

/**
 * Remove traces from old pipelines, keeping only the last `keepPipelines`.
 */
export function pruneOldTraces(db: Database.Database, keepPipelines: number = 20): number {
  // Two-step approach: find pipelines to keep, then delete the rest.
  // SQLite doesn't allow aggregate + ORDER BY + LIMIT in a subquery easily.
  const kept = db.prepare(`
    SELECT pipeline_id FROM (
      SELECT pipeline_id, MAX(timestamp) AS latest
      FROM pipeline_traces
      GROUP BY pipeline_id
      ORDER BY latest DESC
      LIMIT ?
    )
  `).all(keepPipelines) as Array<{ pipeline_id: string }>;

  if (kept.length === 0) return 0;

  const keepIds = kept.map(r => r.pipeline_id);
  const placeholders = keepIds.map(() => '?').join(',');
  const result = db.prepare(
    `DELETE FROM pipeline_traces WHERE pipeline_id NOT IN (${placeholders})`,
  ).run(...keepIds);
  return result.changes;
}

/**
 * Reset the cached prepared statement (for testing or DB handle changes).
 */
export function resetTraceCache(): void {
  _insertStmt = null;
}
