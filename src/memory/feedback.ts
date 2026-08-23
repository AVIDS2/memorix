import { randomUUID } from 'node:crypto';
import type { ObservationStatus } from '../types.js';
import { getDatabase } from '../store/sqlite-db.js';
export { feedbackWeightMultiplier } from './feedback-model.js';

export type MemoryFeedbackSignal =
  | 'user-correction'
  | 'verification-success'
  | 'verification-failure'
  | 'code-change'
  | 'used'
  | 'not-used'
  | 'code-conflict'
  | 'strengthen'
  | 'weaken'
  | 'revoke';

export interface MemoryFeedbackEvent {
  signal: MemoryFeedbackSignal;
  at: string;
  actor?: string;
  note?: string;
  sourceRef?: string;
  targetEventId?: string;
}

export interface FeedbackState {
  weight: number;
  status: ObservationStatus;
  audit: MemoryFeedbackEvent[];
}

export type FeedbackCandidateKind = 'observation' | 'claim' | 'durable-memory' | 'workflow';

export interface PersistedFeedbackEvent extends MemoryFeedbackEvent {
  id: string;
  projectId: string;
  candidateKind: FeedbackCandidateKind;
  candidateId: string;
  delta: number;
}

export const FEEDBACK_DELTAS: Record<Exclude<MemoryFeedbackSignal, 'revoke'>, number> = {
  'user-correction': -0.35,
  'verification-success': 0.25,
  'verification-failure': -0.25,
  'code-change': -0.15,
  used: 0.1,
  'not-used': -0.05,
  'code-conflict': -0.4,
  strengthen: 0.2,
  weaken: -0.2,
};

/** Deterministic feedback reducer used by MCP/CLI adapters and tests. */
export function applyMemoryFeedback(
  current: FeedbackState,
  event: MemoryFeedbackEvent,
): FeedbackState {
  const delta = event.signal === 'revoke' ? 0 : FEEDBACK_DELTAS[event.signal];
  const weight = Math.max(0, Math.min(2, current.weight + delta));
  const status: ObservationStatus = (event.signal === 'code-conflict' || event.signal === 'user-correction' || event.signal === 'weaken') && weight < 0.5
    ? 'archived'
    : current.status;
  return { weight, status, audit: [...current.audit, { ...event }] };
}

function rowToEvent(row: any): PersistedFeedbackEvent {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    candidateKind: row.candidate_kind,
    candidateId: String(row.candidate_id),
    signal: row.signal,
    ...(row.observed_at ? { at: String(row.observed_at) } : { at: new Date().toISOString() }),
    ...(row.actor ? { actor: String(row.actor) } : {}),
    ...(row.note ? { note: String(row.note) } : {}),
    ...(row.source_ref ? { sourceRef: String(row.source_ref) } : {}),
    ...(row.target_event_id ? { targetEventId: String(row.target_event_id) } : {}),
    delta: Number(row.delta ?? 0),
  };
}

function candidateKey(projectId: string, candidateKind: FeedbackCandidateKind, candidateId: string): string {
  return `${projectId}\u0000${candidateKind}\u0000${candidateId}`;
}

/**
 * Durable feedback loop. Events are append-only; the state row is a materialized
 * projection rebuilt from non-revoked events, so undo never destroys audit truth.
 */
export class MemoryFeedbackStore {
  private db: any = null;

  async init(dataDir: string): Promise<void> {
    this.db = getDatabase(dataDir);
  }

  private requireDb(): any {
    if (!this.db) throw new Error('MemoryFeedbackStore is not initialized.');
    return this.db;
  }

  private loadEvents(projectId: string, candidateKind: FeedbackCandidateKind, candidateId: string): PersistedFeedbackEvent[] {
    return this.requireDb().prepare(`
      SELECT * FROM memory_feedback_events
      WHERE project_id = ? AND candidate_kind = ? AND candidate_id = ?
      ORDER BY observed_at ASC, rowid ASC
    `).all(projectId, candidateKind, candidateId).map(rowToEvent);
  }

  private rebuild(projectId: string, candidateKind: FeedbackCandidateKind, candidateId: string): FeedbackState {
    const events = this.loadEvents(projectId, candidateKind, candidateId);
    const revoked = new Set(events.filter((event) => event.signal === 'revoke' && event.targetEventId).map((event) => event.targetEventId!));
    let state: FeedbackState = { weight: 1, status: 'active', audit: [] };
    for (const event of events) {
      if (event.signal === 'revoke' || revoked.has(event.id)) {
        state.audit.push(event);
        continue;
      }
      state = applyMemoryFeedback(state, event);
    }
    this.requireDb().prepare(`
      INSERT INTO memory_feedback_states (project_id, candidate_kind, candidate_id, weight, lifecycle_status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, candidate_kind, candidate_id) DO UPDATE SET
        weight = excluded.weight, lifecycle_status = excluded.lifecycle_status, updated_at = excluded.updated_at
    `).run(projectId, candidateKind, candidateId, state.weight, state.status, new Date().toISOString());
    return state;
  }

  getState(projectId: string, candidateKind: FeedbackCandidateKind, candidateId: string): FeedbackState {
    const row = this.requireDb().prepare(`
      SELECT weight, lifecycle_status FROM memory_feedback_states
      WHERE project_id = ? AND candidate_kind = ? AND candidate_id = ?
    `).get(projectId, candidateKind, candidateId);
    if (!row) return { weight: 1, status: 'active', audit: [] };
    return {
      weight: Number(row.weight ?? 1),
      status: row.lifecycle_status ?? 'active',
      audit: this.loadEvents(projectId, candidateKind, candidateId),
    };
  }

  listStates(projectId: string, candidateKind: FeedbackCandidateKind = 'observation'): Array<{ candidateId: string; weight: number; status: ObservationStatus; updatedAt: string }> {
    return this.requireDb().prepare(`
      SELECT candidate_id, weight, lifecycle_status, updated_at
      FROM memory_feedback_states WHERE project_id = ? AND candidate_kind = ?
      ORDER BY updated_at DESC
    `).all(projectId, candidateKind).map((row: any) => ({
      candidateId: String(row.candidate_id),
      weight: Number(row.weight),
      status: row.lifecycle_status,
      updatedAt: String(row.updated_at),
    }));
  }

  weights(projectId: string, candidateKind: FeedbackCandidateKind = 'observation'): Map<string, FeedbackState> {
    const states = new Map<string, FeedbackState>();
    for (const row of this.listStates(projectId, candidateKind)) {
      states.set(row.candidateId, this.getState(projectId, candidateKind, row.candidateId));
    }
    return states;
  }

  record(input: {
    projectId: string;
    candidateKind: FeedbackCandidateKind;
    candidateId: string;
    signal: MemoryFeedbackSignal;
    sourceRef: string;
    actor?: string;
    note?: string;
    targetEventId?: string;
    at?: string;
  }): { event: PersistedFeedbackEvent; state: FeedbackState } {
    if (input.signal === 'revoke' && !input.targetEventId) {
      throw new Error('A revoke feedback event requires targetEventId.');
    }
    if (input.signal === 'revoke') {
      const target = this.requireDb().prepare(`
        SELECT 1 FROM memory_feedback_events
        WHERE id = ? AND project_id = ? AND candidate_kind = ? AND candidate_id = ?
      `).get(input.targetEventId, input.projectId, input.candidateKind, input.candidateId);
      if (!target) throw new Error('The feedback event to revoke was not found in the same candidate scope.');
    }
    const event: PersistedFeedbackEvent = {
      id: randomUUID(),
      projectId: input.projectId,
      candidateKind: input.candidateKind,
      candidateId: input.candidateId,
      signal: input.signal,
      sourceRef: input.sourceRef,
      ...(input.actor ? { actor: input.actor } : {}),
      ...(input.note ? { note: input.note.slice(0, 2_000) } : {}),
      ...(input.targetEventId ? { targetEventId: input.targetEventId } : {}),
      at: input.at ?? new Date().toISOString(),
      delta: input.signal === 'revoke' ? 0 : FEEDBACK_DELTAS[input.signal],
    };
    this.requireDb().prepare(`
      INSERT INTO memory_feedback_events (
        id, project_id, candidate_kind, candidate_id, signal, actor, note,
        source_ref, target_event_id, delta, observed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id, event.projectId, event.candidateKind, event.candidateId, event.signal,
      event.actor ?? null, event.note ?? null, event.sourceRef, event.targetEventId ?? null,
      event.delta, event.at,
    );
    return { event, state: this.rebuild(input.projectId, input.candidateKind, input.candidateId) };
  }

  audit(projectId: string, candidateKind: FeedbackCandidateKind, candidateId: string, limit = 100): PersistedFeedbackEvent[] {
    return this.requireDb().prepare(`
      SELECT * FROM memory_feedback_events
      WHERE project_id = ? AND candidate_kind = ? AND candidate_id = ?
      ORDER BY observed_at DESC, rowid DESC LIMIT ?
    `).all(projectId, candidateKind, candidateId, Math.min(200, Math.max(1, Math.floor(limit)))).map(rowToEvent);
  }
}
