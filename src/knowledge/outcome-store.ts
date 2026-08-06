import { randomUUID } from 'node:crypto';
import { sanitizeCredentials } from '../memory/secret-filter.js';
import { getDatabase } from '../store/sqlite-db.js';
import {
  MEMORY_OUTCOME_CANDIDATE_KINDS,
  MEMORY_OUTCOME_SIGNAL_KINDS,
  type MemoryOutcomeCandidateKind,
  type MemoryOutcomeSignal,
  type MemoryOutcomeSignalKind,
} from './outcome-types.js';

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function text(value: string, field: string, max = 1_000): string {
  const safe = sanitizeCredentials(value).replace(/\s+/g, ' ').trim();
  if (!safe) throw new Error('Outcome signal ' + field + ' is required.');
  if (safe.length > max) throw new Error('Outcome signal ' + field + ' is too long.');
  return safe;
}

function oneOf<T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    throw new Error('Outcome signal ' + field + ' is invalid.');
  }
  return value as T[number];
}

function rowToSignal(row: any): MemoryOutcomeSignal {
  return {
    id: row.id,
    projectId: row.projectId,
    candidateKind: row.candidateKind,
    candidateId: row.candidateId,
    kind: row.kind,
    sourceRef: row.sourceRef,
    ...(optionalText(row.snapshotId) ? { snapshotId: row.snapshotId } : {}),
    ...(optionalText(row.detail) ? { detail: row.detail } : {}),
    observedAt: row.observedAt,
  } as MemoryOutcomeSignal;
}

/** Persistence only; callers decide which real-world event is worth recording. */
export class OutcomeStore {
  private db: any = null;

  async init(dataDir: string): Promise<void> {
    this.db = getDatabase(dataDir);
  }

  record(input: Omit<MemoryOutcomeSignal, 'id' | 'observedAt'> & { observedAt?: string }): MemoryOutcomeSignal {
    const signal: MemoryOutcomeSignal = {
      id: randomUUID(),
      projectId: text(input.projectId, 'project id'),
      candidateKind: oneOf(input.candidateKind, MEMORY_OUTCOME_CANDIDATE_KINDS, 'candidate kind'),
      candidateId: text(input.candidateId, 'candidate id'),
      kind: oneOf(input.kind, MEMORY_OUTCOME_SIGNAL_KINDS, 'kind'),
      sourceRef: text(input.sourceRef, 'source reference'),
      ...(input.snapshotId ? { snapshotId: text(input.snapshotId, 'snapshot id') } : {}),
      ...(input.detail ? { detail: text(input.detail, 'detail') } : {}),
      observedAt: input.observedAt ?? new Date().toISOString(),
    };
    this.db.prepare(`
      INSERT INTO memory_outcome_signals (
        id, projectId, candidateKind, candidateId, kind, sourceRef, snapshotId, detail, observedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      signal.id,
      signal.projectId,
      signal.candidateKind,
      signal.candidateId,
      signal.kind,
      signal.sourceRef,
      signal.snapshotId ?? null,
      signal.detail ?? null,
      signal.observedAt,
    );
    return signal;
  }

  latestForCandidates(
    projectId: string,
    candidateKind: MemoryOutcomeCandidateKind,
    candidateIds: string[],
  ): Map<string, MemoryOutcomeSignal> {
    const ids = [...new Set(candidateIds.filter(Boolean))];
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT * FROM memory_outcome_signals
      WHERE projectId = ? AND candidateKind = ? AND candidateId IN (${placeholders})
      ORDER BY observedAt DESC, id DESC
    `).all(projectId, candidateKind, ...ids);
    const latest = new Map<string, MemoryOutcomeSignal>();
    for (const row of rows) {
      const signal = rowToSignal(row);
      if (!latest.has(signal.candidateId)) latest.set(signal.candidateId, signal);
    }
    return latest;
  }
}
