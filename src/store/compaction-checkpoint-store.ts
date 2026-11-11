import { createHash, randomUUID } from 'node:crypto';
import type {
  CompactionCaptureKind,
  CompactionCheckpoint,
  CompactionCheckpointStatus,
  CompactionReason,
} from '../types.js';
import { sanitizeCredentials } from '../memory/secret-filter.js';
import { getDatabase } from './sqlite-db.js';

const MAX_SUMMARY_CHARS = 24_000;
const MAX_DETAILS_CHARS = 4_000;

export interface RecordCompactionPreflightInput {
  projectId: string;
  sessionId: string;
  agent: string;
  reason?: CompactionReason;
  sourceEvent: string;
  transcriptAvailable?: boolean;
  capturedAt?: string;
}

export interface CompleteCompactionCheckpointInput {
  projectId: string;
  sessionId: string;
  agent: string;
  reason?: CompactionReason;
  sourceEvent: string;
  sourceKey?: string;
  summary?: string;
  tokensBefore?: number;
  firstKeptEntryId?: string;
  details?: Record<string, unknown>;
  completedAt?: string;
}

export interface ListCompactionCheckpointsOptions {
  projectId: string;
  sessionId?: string;
  agent?: string;
  includeArchived?: boolean;
  limit?: number;
}

export interface FindLatestCompletedCheckpointOptions {
  /**
   * A Hook may already have delivered this exact host session's checkpoint via
   * an official native context channel. Do not put it back into its generic
   * Autopilot brief on a later event from the same session.
   */
  excludeSession?: {
    sessionId: string;
    agent: string;
  };
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseDetails(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeSummary(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  return sanitizeCredentials(value).slice(0, MAX_SUMMARY_CHARS).trim() || undefined;
}

function sanitizeDetails(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const sanitized = sanitizeCredentials(JSON.stringify(value));
    if (sanitized.length > MAX_DETAILS_CHARS) return { truncated: true };
    const parsed = JSON.parse(sanitized);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return { unavailable: true };
  }
}

function sourceKeyFor(input: CompleteCompactionCheckpointInput, summary?: string): string {
  if (input.sourceKey?.trim()) return input.sourceKey.trim().slice(0, 300);
  const material = [
    input.projectId,
    input.sessionId,
    input.agent,
    input.sourceEvent,
    summary ?? '',
    input.tokensBefore ?? '',
    input.firstKeptEntryId ?? '',
  ].join('\u0000');
  return `derived:${createHash('sha256').update(material).digest('hex').slice(0, 32)}`;
}

function rowToCheckpoint(row: any): CompactionCheckpoint {
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    agent: row.agent,
    phase: row.phase,
    captureKind: row.capture_kind,
    reason: row.reason,
    sourceEvent: row.source_event,
    sourceKey: row.source_key,
    ...(optionalText(row.summary) ? { summary: row.summary } : {}),
    ...(optionalNumber(row.tokens_before) !== undefined ? { tokensBefore: Number(row.tokens_before) } : {}),
    ...(optionalText(row.first_kept_entry_id) ? { firstKeptEntryId: row.first_kept_entry_id } : {}),
    ...(parseDetails(row.details_json) ? { details: parseDetails(row.details_json) } : {}),
    transcriptAvailable: Boolean(row.transcript_available),
    status: row.status as CompactionCheckpointStatus,
    preCapturedAt: row.pre_captured_at,
    ...(optionalText(row.completed_at) ? { completedAt: row.completed_at } : {}),
    ...(optionalText(row.delivered_at) ? { deliveredAt: row.delivered_at } : {}),
    deliveryCount: Number(row.delivery_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeReason(value: CompactionReason | undefined): CompactionReason {
  return value === 'manual' || value === 'auto' ? value : 'unknown';
}

function safeLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value == null) return fallback;
  return Math.max(1, Math.min(500, Math.floor(value)));
}

/**
 * SQLite persistence for host-native compaction lifecycle records.
 *
 * The store deliberately keeps evidence separate from Observations so a
 * compactor's summary cannot silently become durable project knowledge.
 */
export class CompactionCheckpointStore {
  private readonly db: any;

  constructor(dataDir: string) {
    this.db = getDatabase(dataDir);
  }

  recordPreflight(input: RecordCompactionPreflightInput): CompactionCheckpoint {
    const pending = this.db.prepare(`
      SELECT * FROM compaction_checkpoints
      WHERE project_id = ? AND session_id = ? AND agent = ?
        AND phase = 'pre' AND status = 'active'
      ORDER BY pre_captured_at DESC, created_at DESC
      LIMIT 1
    `).get(input.projectId, input.sessionId, input.agent);
    if (pending) return rowToCheckpoint(pending);

    const now = input.capturedAt ?? new Date().toISOString();
    const checkpoint: CompactionCheckpoint = {
      id: randomUUID(),
      projectId: input.projectId,
      sessionId: input.sessionId,
      agent: input.agent,
      phase: 'pre',
      captureKind: 'preflight',
      reason: safeReason(input.reason),
      sourceEvent: input.sourceEvent,
      sourceKey: `pre:${randomUUID()}`,
      transcriptAvailable: Boolean(input.transcriptAvailable),
      status: 'active',
      preCapturedAt: now,
      deliveryCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.insert(checkpoint);
    return checkpoint;
  }

  complete(input: CompleteCompactionCheckpointInput): CompactionCheckpoint {
    const completedAt = input.completedAt ?? new Date().toISOString();
    const summary = sanitizeSummary(input.summary);
    const pending = this.db.prepare(`
      SELECT * FROM compaction_checkpoints
      WHERE project_id = ? AND session_id = ? AND agent = ?
        AND phase = 'pre' AND status = 'active'
      ORDER BY pre_captured_at DESC, created_at DESC
      LIMIT 1
    `).get(input.projectId, input.sessionId, input.agent);

    // Hosts such as Codex and Claude expose a post-compact lifecycle signal
    // but no event ID. Correlate it with the newest preflight marker so two
    // compactions in one long session remain distinct. With no fresh marker,
    // treat another identical lifecycle signal as a duplicate rather than
    // creating a stream of empty checkpoints.
    if (!input.sourceKey?.trim() && !summary && input.tokensBefore === undefined && !input.firstKeptEntryId && !pending) {
      const priorLifecycle = this.db.prepare(`
        SELECT * FROM compaction_checkpoints
        WHERE project_id = ? AND session_id = ? AND agent = ?
          AND phase = 'complete' AND capture_kind = 'lifecycle'
          AND source_event = ? AND status = 'active'
        ORDER BY completed_at DESC, created_at DESC
        LIMIT 1
      `).get(input.projectId, input.sessionId, input.agent, input.sourceEvent);
      if (priorLifecycle) return rowToCheckpoint(priorLifecycle);
    }

    const sourceKey = input.sourceKey?.trim()
      ? input.sourceKey.trim().slice(0, 300)
      : pending
        ? `lifecycle:${pending.id}`
        : sourceKeyFor(input, summary);
    const existing = this.db.prepare(`
      SELECT * FROM compaction_checkpoints
      WHERE project_id = ? AND source_key = ?
      LIMIT 1
    `).get(input.projectId, sourceKey);
    if (existing) return rowToCheckpoint(existing);

    const captureKind: CompactionCaptureKind = summary ? 'native-summary' : 'lifecycle';
    const details = sanitizeDetails(input.details);

    if (pending) {
      const checkpoint = rowToCheckpoint(pending);
      const nextReason = safeReason(input.reason) === 'unknown'
        ? checkpoint.reason
        : safeReason(input.reason);
      this.db.prepare(`
        UPDATE compaction_checkpoints
        SET phase = 'complete', capture_kind = ?, reason = ?, source_event = ?, source_key = ?,
            summary = ?, tokens_before = ?, first_kept_entry_id = ?, details_json = ?,
            completed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        captureKind,
        nextReason,
        input.sourceEvent,
        sourceKey,
        summary ?? null,
        input.tokensBefore ?? null,
        input.firstKeptEntryId ?? null,
        JSON.stringify(details ?? {}),
        completedAt,
        completedAt,
        checkpoint.id,
      );
      return this.get(checkpoint.id)!;
    }

    const checkpoint: CompactionCheckpoint = {
      id: randomUUID(),
      projectId: input.projectId,
      sessionId: input.sessionId,
      agent: input.agent,
      phase: 'complete',
      captureKind,
      reason: safeReason(input.reason),
      sourceEvent: input.sourceEvent,
      sourceKey,
      ...(summary ? { summary } : {}),
      ...(input.tokensBefore !== undefined ? { tokensBefore: input.tokensBefore } : {}),
      ...(input.firstKeptEntryId ? { firstKeptEntryId: input.firstKeptEntryId } : {}),
      ...(details ? { details } : {}),
      transcriptAvailable: false,
      status: 'active',
      preCapturedAt: completedAt,
      completedAt,
      deliveryCount: 0,
      createdAt: completedAt,
      updatedAt: completedAt,
    };
    this.insert(checkpoint);
    return checkpoint;
  }

  get(id: string): CompactionCheckpoint | undefined {
    const row = this.db.prepare('SELECT * FROM compaction_checkpoints WHERE id = ?').get(id);
    return row ? rowToCheckpoint(row) : undefined;
  }

  list(options: ListCompactionCheckpointsOptions): CompactionCheckpoint[] {
    const conditions = ['project_id = ?'];
    const values: unknown[] = [options.projectId];
    if (options.sessionId) {
      conditions.push('session_id = ?');
      values.push(options.sessionId);
    }
    if (options.agent) {
      conditions.push('agent = ?');
      values.push(options.agent);
    }
    if (!options.includeArchived) {
      conditions.push("status = 'active'");
    }
    const rows = this.db.prepare(`
      SELECT * FROM compaction_checkpoints
      WHERE ${conditions.join(' AND ')}
      ORDER BY COALESCE(completed_at, pre_captured_at) DESC, created_at DESC
      LIMIT ?
    `).all(...values, safeLimit(options.limit, 20));
    return rows.map(rowToCheckpoint);
  }

  findUndelivered(projectId: string, sessionId: string, agent: string): CompactionCheckpoint | undefined {
    const row = this.db.prepare(`
      SELECT * FROM compaction_checkpoints
      WHERE project_id = ? AND session_id = ? AND agent = ?
        AND phase = 'complete' AND status = 'active' AND delivered_at IS NULL
      ORDER BY completed_at DESC, created_at DESC
      LIMIT 1
    `).get(projectId, sessionId, agent);
    return row ? rowToCheckpoint(row) : undefined;
  }

  findLatestCompleted(
    projectId: string,
    options: FindLatestCompletedCheckpointOptions = {},
  ): CompactionCheckpoint | undefined {
    const excludeSession = options.excludeSession;
    const exclusion = excludeSession
      ? ' AND NOT (session_id = ? AND agent = ? )'
      : '';
    const values = excludeSession
      ? [projectId, excludeSession.sessionId, excludeSession.agent]
      : [projectId];
    const row = this.db.prepare(`
      SELECT * FROM compaction_checkpoints
      WHERE project_id = ? AND phase = 'complete' AND status = 'active'
      ${exclusion}
      ORDER BY completed_at DESC, created_at DESC
      LIMIT 1
    `).get(...values);
    return row ? rowToCheckpoint(row) : undefined;
  }

  archive(id: string, archivedAt = new Date().toISOString()): CompactionCheckpoint | undefined {
    const result = this.db.prepare(`
      UPDATE compaction_checkpoints
      SET status = 'archived', updated_at = ?
      WHERE id = ? AND status = 'active'
    `).run(archivedAt, id);
    return Number(result.changes ?? 0) > 0 ? this.get(id) : undefined;
  }

  markDelivered(id: string, deliveredAt = new Date().toISOString()): CompactionCheckpoint | undefined {
    const result = this.db.prepare(`
      UPDATE compaction_checkpoints
      SET delivered_at = ?, delivery_count = delivery_count + 1, updated_at = ?
      WHERE id = ? AND phase = 'complete' AND status = 'active' AND delivered_at IS NULL
    `).run(deliveredAt, deliveredAt, id);
    return Number(result.changes ?? 0) > 0 ? this.get(id) : undefined;
  }

  private insert(checkpoint: CompactionCheckpoint): void {
    this.db.prepare(`
      INSERT INTO compaction_checkpoints (
        id, project_id, session_id, agent, phase, capture_kind, reason,
        source_event, source_key, summary, tokens_before, first_kept_entry_id,
        details_json, transcript_available, status, pre_captured_at, completed_at,
        delivered_at, delivery_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      checkpoint.id,
      checkpoint.projectId,
      checkpoint.sessionId,
      checkpoint.agent,
      checkpoint.phase,
      checkpoint.captureKind,
      checkpoint.reason,
      checkpoint.sourceEvent,
      checkpoint.sourceKey,
      checkpoint.summary ?? null,
      checkpoint.tokensBefore ?? null,
      checkpoint.firstKeptEntryId ?? null,
      JSON.stringify(checkpoint.details ?? {}),
      checkpoint.transcriptAvailable ? 1 : 0,
      checkpoint.status,
      checkpoint.preCapturedAt,
      checkpoint.completedAt ?? null,
      checkpoint.deliveredAt ?? null,
      checkpoint.deliveryCount,
      checkpoint.createdAt,
      checkpoint.updatedAt,
    );
  }
}
