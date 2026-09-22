/**
 * Durable, privacy-safe records for agent tool effects.
 *
 * This is deliberately not a claim of exactly-once tool delivery. It records
 * what the coordinator observed, whether a result arrived, and what replay
 * policy a future recovery path must apply before repeating the effect.
 */

import { createHash, randomUUID } from 'node:crypto';
import { sanitizeCredentials } from '../memory/secret-filter.js';
import { classifyTool, type RiskTier } from './permission.js';

export type AgentEffectStatus = 'observed' | 'succeeded' | 'failed' | 'unknown';
export type AgentEffectReplayPolicy = 'safe' | 'requires-idempotency-key';

export interface AgentEffectRecord {
  id: string;
  pipelineId: string;
  taskId: string;
  attempt: number;
  effectKey: string;
  tool: string;
  riskTier: RiskTier;
  replayPolicy: AgentEffectReplayPolicy;
  status: AgentEffectStatus;
  callId?: string;
  idempotencyKey: string;
  inputFingerprint?: string;
  detail?: string;
  startedAt: number;
  finishedAt?: number;
}

export function fingerprintEffectInput(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  try {
    const safe = sanitizeCredentials(JSON.stringify(input));
    return createHash('sha256').update(safe).digest('hex').slice(0, 24);
  } catch {
    return undefined;
  }
}

function rowToEffect(row: any): AgentEffectRecord {
  return {
    id: String(row.id),
    pipelineId: String(row.pipeline_id),
    taskId: String(row.task_id),
    attempt: Number(row.attempt),
    effectKey: String(row.effect_key),
    tool: String(row.tool),
    riskTier: row.risk_tier as RiskTier,
    replayPolicy: row.replay_policy as AgentEffectReplayPolicy,
    status: row.status as AgentEffectStatus,
    ...(row.call_id ? { callId: String(row.call_id) } : {}),
    idempotencyKey: String(row.idempotency_key),
    ...(row.input_fingerprint ? { inputFingerprint: String(row.input_fingerprint) } : {}),
    ...(row.detail ? { detail: String(row.detail) } : {}),
    startedAt: Number(row.started_at),
    ...(row.finished_at ? { finishedAt: Number(row.finished_at) } : {}),
  };
}

export class AgentEffectLedger {
  constructor(private readonly db: any) {}

  observe(input: {
    pipelineId: string;
    taskId: string;
    attempt: number;
    effectKey: string;
    tool: string;
    callId?: string;
    input?: unknown;
  }): AgentEffectRecord {
    const existing = this.db.prepare(`
      SELECT * FROM agent_effects
      WHERE pipeline_id = ? AND task_id = ? AND attempt = ? AND effect_key = ?
    `).get(input.pipelineId, input.taskId, input.attempt, input.effectKey);
    if (existing) return rowToEffect(existing);

    const riskTier = classifyTool(input.tool);
    const replayPolicy: AgentEffectReplayPolicy = riskTier === 'safe'
      ? 'safe'
      : 'requires-idempotency-key';
    const idempotencyKey = `${input.pipelineId}:${input.taskId}:${input.attempt}:${input.effectKey}`;
    const now = Date.now();
    const record: AgentEffectRecord = {
      id: randomUUID(),
      pipelineId: input.pipelineId,
      taskId: input.taskId,
      attempt: input.attempt,
      effectKey: input.effectKey,
      tool: input.tool.slice(0, 200),
      riskTier,
      replayPolicy,
      status: 'observed',
      ...(input.callId ? { callId: input.callId.slice(0, 200) } : {}),
      idempotencyKey,
      ...(fingerprintEffectInput(input.input) ? { inputFingerprint: fingerprintEffectInput(input.input) } : {}),
      startedAt: now,
    };
    this.db.prepare(`
      INSERT OR IGNORE INTO agent_effects (
        id, pipeline_id, task_id, attempt, effect_key, tool, risk_tier,
        replay_policy, status, call_id, idempotency_key, input_fingerprint,
        detail, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id, record.pipelineId, record.taskId, record.attempt, record.effectKey,
      record.tool, record.riskTier, record.replayPolicy, record.status,
      record.callId ?? null, record.idempotencyKey, record.inputFingerprint ?? null,
      null, record.startedAt, null,
    );
    return rowToEffect(this.db.prepare(`
      SELECT * FROM agent_effects
      WHERE pipeline_id = ? AND task_id = ? AND attempt = ? AND effect_key = ?
    `).get(input.pipelineId, input.taskId, input.attempt, input.effectKey));
  }

  settle(input: {
    pipelineId: string;
    taskId: string;
    attempt: number;
    effectKey: string;
    status: Exclude<AgentEffectStatus, 'observed'>;
    detail?: string;
  }): AgentEffectRecord | undefined {
    const detail = input.detail ? sanitizeCredentials(input.detail).slice(0, 500) : undefined;
    this.db.prepare(`
      UPDATE agent_effects
      SET status = ?, detail = ?, finished_at = ?
      WHERE pipeline_id = ? AND task_id = ? AND attempt = ? AND effect_key = ?
    `).run(
      input.status, detail ?? null, Date.now(), input.pipelineId, input.taskId,
      input.attempt, input.effectKey,
    );
    const row = this.db.prepare(`
      SELECT * FROM agent_effects
      WHERE pipeline_id = ? AND task_id = ? AND attempt = ? AND effect_key = ?
    `).get(input.pipelineId, input.taskId, input.attempt, input.effectKey);
    return row ? rowToEffect(row) : undefined;
  }

  markAttemptUnknown(pipelineId: string, taskId: string, attempt: number): number {
    const result = this.db.prepare(`
      UPDATE agent_effects
      SET status = 'unknown', detail = COALESCE(detail, 'No matching tool result observed'), finished_at = ?
      WHERE pipeline_id = ? AND task_id = ? AND attempt = ? AND status = 'observed'
    `).run(Date.now(), pipelineId, taskId, attempt);
    return Number(result.changes ?? 0);
  }

  list(pipelineId: string, taskId?: string): AgentEffectRecord[] {
    const rows = taskId
      ? this.db.prepare('SELECT * FROM agent_effects WHERE pipeline_id = ? AND task_id = ? ORDER BY started_at ASC, rowid ASC').all(pipelineId, taskId)
      : this.db.prepare('SELECT * FROM agent_effects WHERE pipeline_id = ? ORDER BY started_at ASC, rowid ASC').all(pipelineId);
    return rows.map(rowToEffect);
  }
}
