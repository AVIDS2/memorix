import { createHash, randomUUID } from 'node:crypto';
import type { Observation } from '../types.js';
import { getDatabase } from './sqlite-db.js';

export type EvidenceCandidateKind = 'observation' | 'code' | 'git' | 'test' | 'document' | 'workflow' | 'graph';
export type EvidenceVerification = 'unverified' | 'verified' | 'conflicted';
export type EvidenceFreshness = 'current' | 'stale' | 'unknown';

export interface EvidenceCardRecord {
  id: string;
  projectId: string;
  candidateKind: EvidenceCandidateKind;
  candidateId: string;
  title: string;
  summary: string;
  entityName?: string;
  sourceKind: string;
  sourceRef: string;
  locator?: string;
  capturedHash?: string;
  sessionId?: string;
  status: string;
  verification: EvidenceVerification;
  freshness: EvidenceFreshness;
  staleReason?: string;
  files: string[];
  relatedEntities: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceCardEvent {
  id: string;
  projectId: string;
  cardId: string;
  kind: string;
  detail?: string;
  createdAt: string;
}

function safeJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToCard(row: any): EvidenceCardRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    candidateKind: row.candidate_kind,
    candidateId: String(row.candidate_id),
    title: String(row.title),
    summary: String(row.summary ?? ''),
    ...(row.entity_name ? { entityName: String(row.entity_name) } : {}),
    sourceKind: String(row.source_kind),
    sourceRef: String(row.source_ref),
    ...(row.locator ? { locator: String(row.locator) } : {}),
    ...(row.captured_hash ? { capturedHash: String(row.captured_hash) } : {}),
    ...(row.session_id ? { sessionId: String(row.session_id) } : {}),
    status: String(row.status ?? 'active'),
    verification: row.verification,
    freshness: row.freshness,
    ...(row.stale_reason ? { staleReason: String(row.stale_reason) } : {}),
    files: safeJson(row.files_json, []),
    relatedEntities: safeJson(row.related_entities_json, []),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function observationHash(observation: Observation): string {
  return createHash('sha256')
    .update(JSON.stringify({
      projectId: observation.projectId,
      id: observation.id,
      title: observation.title,
      narrative: observation.narrative,
      facts: observation.facts,
      files: observation.filesModified,
      relatedEntities: observation.relatedEntities,
    }))
    .digest('hex');
}

function sourceKind(observation: Observation): string {
  if (observation.source === 'git' || observation.sourceDetail === 'git-ingest') return 'git';
  if (observation.sourceDetail === 'hook') return 'hook';
  return observation.source ?? 'agent';
}

/** SQLite-backed provenance cards used by MCP, CLI, and Dashboard surfaces. */
export class EvidenceCardStore {
  private db: any = null;

  async init(dataDir: string): Promise<void> {
    this.db = getDatabase(dataDir);
  }

  private requireDb(): any {
    if (!this.db) throw new Error('EvidenceCardStore is not initialized.');
    return this.db;
  }

  upsertObservation(observation: Observation): EvidenceCardRecord {
    const db = this.requireDb();
    const now = new Date().toISOString();
    const card: EvidenceCardRecord = {
      id: `evidence:observation:${observation.projectId}:${observation.id}`,
      projectId: observation.projectId,
      candidateKind: 'observation',
      candidateId: String(observation.id),
      title: observation.title,
      summary: observation.narrative.slice(0, 500),
      entityName: observation.entityName,
      sourceKind: sourceKind(observation),
      sourceRef: `observation:${observation.id}`,
      locator: observation.filesModified?.join(', ') || `observation:${observation.id}`,
      capturedHash: observationHash(observation),
      ...(observation.sessionId ? { sessionId: observation.sessionId } : {}),
      status: observation.status ?? 'active',
      verification: observation.status === 'resolved' ? 'verified' : 'unverified',
      freshness: 'current',
      files: observation.filesModified ?? [],
      relatedEntities: observation.relatedEntities ?? [],
      createdAt: observation.createdAt,
      updatedAt: now,
    };
    db.prepare(`
      INSERT INTO evidence_cards (
        id, project_id, candidate_kind, candidate_id, title, summary, entity_name,
        source_kind, source_ref, locator, captured_hash, session_id, status,
        verification, freshness, stale_reason, files_json, related_entities_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
      ON CONFLICT(project_id, candidate_kind, candidate_id) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        entity_name = excluded.entity_name,
        source_kind = excluded.source_kind,
        source_ref = excluded.source_ref,
        locator = excluded.locator,
        captured_hash = excluded.captured_hash,
        session_id = excluded.session_id,
        status = excluded.status,
        freshness = 'current',
        stale_reason = NULL,
        files_json = excluded.files_json,
        related_entities_json = excluded.related_entities_json,
        updated_at = excluded.updated_at
    `).run(
      card.id,
      card.projectId,
      card.candidateKind,
      card.candidateId,
      card.title,
      card.summary,
      card.entityName ?? null,
      card.sourceKind,
      card.sourceRef,
      card.locator ?? null,
      card.capturedHash ?? null,
      card.sessionId ?? null,
      card.status,
      card.verification,
      card.freshness,
      JSON.stringify(card.files),
      JSON.stringify(card.relatedEntities),
      card.createdAt,
      card.updatedAt,
    );
    return this.get(card.projectId, card.candidateKind, card.candidateId) ?? card;
  }

  get(projectId: string, candidateKind: EvidenceCandidateKind, candidateId: string): EvidenceCardRecord | undefined {
    const row = this.requireDb().prepare(`
      SELECT * FROM evidence_cards WHERE project_id = ? AND candidate_kind = ? AND candidate_id = ?
    `).get(projectId, candidateKind, candidateId);
    return row ? rowToCard(row) : undefined;
  }

  list(projectId: string, options: { limit?: number; freshness?: EvidenceFreshness; status?: string } = {}): EvidenceCardRecord[] {
    const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 20)));
    const clauses = ['project_id = ?'];
    const args: unknown[] = [projectId];
    if (options.freshness) { clauses.push('freshness = ?'); args.push(options.freshness); }
    if (options.status) { clauses.push('status = ?'); args.push(options.status); }
    args.push(limit);
    const rows = this.requireDb().prepare(`
      SELECT * FROM evidence_cards WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC, id DESC LIMIT ?
    `).all(...args);
    return rows.map(rowToCard);
  }

  syncObservations(observations: Observation[]): EvidenceCardRecord[] {
    return observations.map((observation) => this.upsertObservation(observation));
  }

  markStaleForPaths(projectId: string, paths: string[], reason = 'source file changed'): number {
    const normalized = new Set(paths.map((value) => value.replace(/\\/g, '/').toLowerCase()));
    if (normalized.size === 0) return 0;
    const db = this.requireDb();
    const rows = db.prepare(`SELECT * FROM evidence_cards WHERE project_id = ? AND freshness != 'stale'`).all(projectId);
    const update = db.prepare(`
      UPDATE evidence_cards SET freshness = 'stale', stale_reason = ?, updated_at = ?
      WHERE id = ?
    `);
    let changed = 0;
    const now = new Date().toISOString();
    const run = db.transaction(() => {
      for (const row of rows) {
        const files = safeJson<string[]>(row.files_json, []);
        if (!files.some((file) => normalized.has(file.replace(/\\/g, '/').toLowerCase()))) continue;
        update.run(reason, now, row.id);
        changed++;
      }
    });
    run();
    return changed;
  }

  setVerification(projectId: string, cardId: string, verification: EvidenceVerification): void {
    this.requireDb().prepare(`
      UPDATE evidence_cards SET verification = ?, updated_at = ? WHERE project_id = ? AND id = ?
    `).run(verification, new Date().toISOString(), projectId, cardId);
  }

  recordEvent(projectId: string, cardId: string, kind: string, detail?: string): EvidenceCardEvent {
    const event: EvidenceCardEvent = {
      id: randomUUID(),
      projectId,
      cardId,
      kind,
      ...(detail ? { detail: detail.slice(0, 2_000) } : {}),
      createdAt: new Date().toISOString(),
    };
    this.requireDb().prepare(`
      INSERT INTO evidence_card_events (id, project_id, card_id, kind, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(event.id, event.projectId, event.cardId, event.kind, event.detail ?? null, event.createdAt);
    return event;
  }

  listEvents(cardId: string, limit = 50): EvidenceCardEvent[] {
    const rows = this.requireDb().prepare(`
      SELECT * FROM evidence_card_events WHERE card_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(cardId, Math.min(200, Math.max(1, Math.floor(limit))));
    return rows.map((row: any) => ({
      id: String(row.id), projectId: String(row.project_id), cardId: String(row.card_id),
      kind: String(row.kind), ...(row.detail ? { detail: String(row.detail) } : {}),
      createdAt: String(row.created_at),
    }));
  }
}

export function buildEvidenceCardId(projectId: string, candidateKind: EvidenceCandidateKind, candidateId: string): string {
  return `evidence:${candidateKind}:${projectId}:${candidateId}`;
}
