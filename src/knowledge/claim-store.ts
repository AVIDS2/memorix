import { createHash, randomUUID } from 'node:crypto';
import { sanitizeCredentials } from '../memory/secret-filter.js';
import { getDatabase } from '../store/sqlite-db.js';
import type {
  ClaimConflict,
  ClaimEvent,
  ClaimEvidenceRef,
  KnowledgeClaim,
  KnowledgeClaimStatus,
} from './types.js';

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function rowToClaim(row: any): KnowledgeClaim {
  return {
    id: row.id,
    projectId: row.projectId,
    subject: row.subject,
    predicate: row.predicate,
    objectValue: row.objectValue,
    scope: row.scope,
    claimKey: row.claimKey,
    conflictKey: row.conflictKey,
    status: row.status,
    confidence: Number(row.confidence),
    observedAt: row.observedAt,
    ...(optionalText(row.validFrom) ? { validFrom: row.validFrom } : {}),
    ...(optionalText(row.validTo) ? { validTo: row.validTo } : {}),
    ...(optionalText(row.supersededBy) ? { supersededBy: row.supersededBy } : {}),
    reviewState: row.reviewState,
    origin: row.origin,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToEvidence(row: any): ClaimEvidenceRef {
  return {
    id: row.id,
    claimId: row.claimId,
    evidenceKind: row.evidenceKind,
    evidenceId: row.evidenceId,
    relation: row.relation,
    ...(optionalText(row.snapshotId) ? { snapshotId: row.snapshotId } : {}),
    ...(optionalText(row.locator) ? { locator: row.locator } : {}),
    ...(optionalText(row.capturedHash) ? { capturedHash: row.capturedHash } : {}),
    createdAt: row.createdAt,
  };
}

function rowToEvent(row: any): ClaimEvent {
  return {
    id: row.id,
    projectId: row.projectId,
    claimId: row.claimId,
    kind: row.kind,
    ...(optionalText(row.fromStatus) ? { fromStatus: row.fromStatus } : {}),
    ...(optionalText(row.toStatus) ? { toStatus: row.toStatus } : {}),
    ...(optionalText(row.relatedClaimId) ? { relatedClaimId: row.relatedClaimId } : {}),
    ...(optionalText(row.detail) ? { detail: row.detail } : {}),
    createdAt: row.createdAt,
  };
}

function evidenceKey(input: Omit<ClaimEvidenceRef, 'id' | 'claimId' | 'createdAt'>): string {
  return createHash('sha256').update(JSON.stringify([
    input.evidenceKind,
    input.evidenceId,
    input.relation,
    input.snapshotId ?? '',
    input.locator ?? '',
    input.capturedHash ?? '',
  ])).digest('hex');
}

/**
 * SQLite access for the claim ledger. Domain policy belongs in claims.ts; this
 * class only preserves records and their audit trail atomically.
 */
export class ClaimStore {
  private db: any = null;

  async init(dataDir: string): Promise<void> {
    this.db = getDatabase(dataDir);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  getClaim(id: string): KnowledgeClaim | undefined {
    const row = this.db.prepare('SELECT * FROM knowledge_claims WHERE id = ?').get(id);
    return row ? rowToClaim(row) : undefined;
  }

  listClaims(
    projectId: string,
    options: { statuses?: readonly KnowledgeClaimStatus[]; limit?: number } = {},
  ): KnowledgeClaim[] {
    const limit = Math.max(1, Math.min(1_000, Math.floor(options.limit ?? 500)));
    if (options.statuses && options.statuses.length > 0) {
      return this.db.prepare(`
        SELECT * FROM knowledge_claims
        WHERE projectId = ? AND status IN (SELECT value FROM json_each(?))
        ORDER BY updatedAt DESC, id
        LIMIT ?
      `).all(projectId, JSON.stringify([...new Set(options.statuses)]), limit).map(rowToClaim);
    }
    return this.db.prepare(`
      SELECT * FROM knowledge_claims
      WHERE projectId = ?
      ORDER BY updatedAt DESC, id
      LIMIT ?
    `).all(projectId, limit).map(rowToClaim);
  }

  findReusableClaim(projectId: string, claimKey: string): KnowledgeClaim | undefined {
    const row = this.db.prepare(`
      SELECT * FROM knowledge_claims
      WHERE projectId = ? AND claimKey = ? AND status IN ('active', 'disputed')
      ORDER BY updatedAt DESC
      LIMIT 1
    `).get(projectId, claimKey);
    return row ? rowToClaim(row) : undefined;
  }

  listClaimsByConflictKey(projectId: string, conflictKey: string): KnowledgeClaim[] {
    return this.db.prepare(`
      SELECT * FROM knowledge_claims
      WHERE projectId = ? AND conflictKey = ?
      ORDER BY createdAt ASC, id
    `).all(projectId, conflictKey).map(rowToClaim);
  }

  listConflicts(projectId: string): ClaimConflict[] {
    const rows = this.db.prepare(`
      SELECT conflictKey
      FROM knowledge_claims
      WHERE projectId = ? AND status IN ('active', 'disputed') AND reviewState = 'approved'
      GROUP BY conflictKey
      HAVING COUNT(DISTINCT claimKey) > 1
      ORDER BY conflictKey
    `).all(projectId) as Array<{ conflictKey: string }>;
    return rows.map(({ conflictKey }) => ({
      conflictKey,
      claims: this.listClaimsByConflictKey(projectId, conflictKey)
        .filter(claim => claim.status === 'active' || claim.status === 'disputed'),
    }));
  }

  insertClaim(claim: KnowledgeClaim): void {
    this.db.prepare(`
      INSERT INTO knowledge_claims (
        id, projectId, subject, predicate, objectValue, scope, claimKey, conflictKey,
        status, confidence, observedAt, validFrom, validTo, supersededBy,
        reviewState, origin, createdAt, updatedAt
      ) VALUES (
        @id, @projectId, @subject, @predicate, @objectValue, @scope, @claimKey, @conflictKey,
        @status, @confidence, @observedAt, @validFrom, @validTo, @supersededBy,
        @reviewState, @origin, @createdAt, @updatedAt
      )
    `).run({
      ...claim,
      validFrom: claim.validFrom ?? null,
      validTo: claim.validTo ?? null,
      supersededBy: claim.supersededBy ?? null,
    });
  }

  updateClaim(claim: KnowledgeClaim): void {
    this.db.prepare(`
      UPDATE knowledge_claims SET
        subject = @subject,
        predicate = @predicate,
        objectValue = @objectValue,
        scope = @scope,
        claimKey = @claimKey,
        conflictKey = @conflictKey,
        status = @status,
        confidence = @confidence,
        observedAt = @observedAt,
        validFrom = @validFrom,
        validTo = @validTo,
        supersededBy = @supersededBy,
        reviewState = @reviewState,
        origin = @origin,
        updatedAt = @updatedAt
      WHERE id = @id
    `).run({
      ...claim,
      validFrom: claim.validFrom ?? null,
      validTo: claim.validTo ?? null,
      supersededBy: claim.supersededBy ?? null,
    });
  }

  touchClaim(id: string, updatedAt: string): void {
    this.db.prepare('UPDATE knowledge_claims SET updatedAt = ? WHERE id = ?').run(updatedAt, id);
  }

  insertEvidence(input: Omit<ClaimEvidenceRef, 'id' | 'createdAt'> & { createdAt?: string }): boolean {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const key = evidenceKey(input);
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO knowledge_claim_evidence (
        id, claimId, evidenceKind, evidenceId, relation, snapshotId,
        locator, capturedHash, evidenceKey, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      input.claimId,
      input.evidenceKind,
      input.evidenceId,
      input.relation,
      input.snapshotId ?? null,
      input.locator ? sanitizeCredentials(input.locator) : null,
      input.capturedHash ?? null,
      key,
      createdAt,
    );
    return Number(result.changes ?? 0) > 0;
  }

  listEvidence(claimId: string): ClaimEvidenceRef[] {
    return this.db.prepare(`
      SELECT * FROM knowledge_claim_evidence
      WHERE claimId = ?
      ORDER BY createdAt ASC, id
    `).all(claimId).map(rowToEvidence);
  }

  recordEvent(input: Omit<ClaimEvent, 'id' | 'createdAt'> & { createdAt?: string }): ClaimEvent {
    const event: ClaimEvent = {
      id: randomUUID(),
      ...input,
      ...(input.detail ? { detail: sanitizeCredentials(input.detail) } : {}),
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.db.prepare(`
      INSERT INTO knowledge_claim_events (
        id, projectId, claimId, kind, fromStatus, toStatus,
        relatedClaimId, detail, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.projectId,
      event.claimId,
      event.kind,
      event.fromStatus ?? null,
      event.toStatus ?? null,
      event.relatedClaimId ?? null,
      event.detail ?? null,
      event.createdAt,
    );
    return event;
  }

  listEvents(claimId: string): ClaimEvent[] {
    return this.db.prepare(`
      SELECT * FROM knowledge_claim_events
      WHERE claimId = ?
      ORDER BY createdAt ASC, id
    `).all(claimId).map(rowToEvent);
  }
}
