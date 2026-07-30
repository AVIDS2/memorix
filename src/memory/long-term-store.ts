import { randomUUID } from 'node:crypto';
import { getDatabase } from '../store/sqlite-db.js';
import type {
  LongTermMemory,
  LongTermMemoryEvidence,
  LongTermMemoryEvent,
} from './long-term-types.js';

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function arrayValue(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function rowToMemory(row: any): LongTermMemory {
  return {
    id: row.id,
    originProjectId: row.originProjectId,
    ownerId: row.ownerId,
    scope: row.scope,
    kind: row.kind,
    state: row.state,
    portability: row.portability,
    title: row.title,
    content: row.content,
    facts: arrayValue(row.factsJson),
    tags: arrayValue(row.tagsJson),
    ...(optionalText(row.applicability) ? { applicability: row.applicability } : {}),
    origin: row.origin,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(optionalText(row.qualifiedAt) ? { qualifiedAt: row.qualifiedAt } : {}),
    ...(optionalText(row.approvedAt) ? { approvedAt: row.approvedAt } : {}),
    ...(optionalText(row.archivedAt) ? { archivedAt: row.archivedAt } : {}),
    ...(optionalText(row.supersededBy) ? { supersededBy: row.supersededBy } : {}),
    ...(optionalText(row.lastValidatedAt) ? { lastValidatedAt: row.lastValidatedAt } : {}),
    accessCount: Number(row.accessCount ?? 0),
    ...(optionalText(row.lastAccessedAt) ? { lastAccessedAt: row.lastAccessedAt } : {}),
  } as LongTermMemory;
}

function rowToEvidence(row: any): LongTermMemoryEvidence {
  return {
    id: row.id,
    memoryId: row.memoryId,
    kind: row.kind,
    referenceId: row.referenceId,
    relation: row.relation,
    ...(optionalText(row.locator) ? { locator: row.locator } : {}),
    ...(optionalText(row.capturedHash) ? { capturedHash: row.capturedHash } : {}),
    createdAt: row.createdAt,
  } as LongTermMemoryEvidence;
}

function rowToEvent(row: any): LongTermMemoryEvent {
  return {
    id: row.id,
    memoryId: row.memoryId,
    kind: row.kind,
    ...(optionalText(row.fromState) ? { fromState: row.fromState } : {}),
    ...(optionalText(row.toState) ? { toState: row.toState } : {}),
    ...(optionalText(row.detail) ? { detail: row.detail } : {}),
    createdAt: row.createdAt,
  } as LongTermMemoryEvent;
}

/** Persistence only. Lifecycle, privacy, and portability policy live in long-term.ts. */
export class LongTermMemoryStore {
  private db: any = null;

  async init(dataDir: string): Promise<void> {
    this.db = getDatabase(dataDir);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  get(id: string): LongTermMemory | undefined {
    const row = this.db.prepare('SELECT * FROM long_term_memories WHERE id = ?').get(id);
    return row ? rowToMemory(row) : undefined;
  }

  list(options: { ownerId?: string; originProjectId?: string; limit?: number } = {}): LongTermMemory[] {
    const limit = Math.max(1, Math.min(1_000, Math.floor(options.limit ?? 500)));
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.ownerId) {
      clauses.push('ownerId = ?');
      params.push(options.ownerId);
    }
    if (options.originProjectId) {
      clauses.push('originProjectId = ?');
      params.push(options.originProjectId);
    }
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
    const rows = this.db.prepare(
      'SELECT * FROM long_term_memories' + where + ' ORDER BY updatedAt DESC, id LIMIT ?',
    ).all(...params, limit);
    return rows.map(rowToMemory);
  }

  insert(memory: LongTermMemory): void {
    this.db.prepare(`
      INSERT INTO long_term_memories (
        id, originProjectId, ownerId, scope, kind, state, portability,
        title, content, factsJson, tagsJson, applicability, origin,
        createdAt, updatedAt, qualifiedAt, approvedAt, archivedAt,
        supersededBy, lastValidatedAt, accessCount, lastAccessedAt
      ) VALUES (
        @id, @originProjectId, @ownerId, @scope, @kind, @state, @portability,
        @title, @content, @factsJson, @tagsJson, @applicability, @origin,
        @createdAt, @updatedAt, @qualifiedAt, @approvedAt, @archivedAt,
        @supersededBy, @lastValidatedAt, @accessCount, @lastAccessedAt
      )
    `).run({
      ...memory,
      factsJson: JSON.stringify(memory.facts),
      tagsJson: JSON.stringify(memory.tags),
      applicability: memory.applicability ?? null,
      qualifiedAt: memory.qualifiedAt ?? null,
      approvedAt: memory.approvedAt ?? null,
      archivedAt: memory.archivedAt ?? null,
      supersededBy: memory.supersededBy ?? null,
      lastValidatedAt: memory.lastValidatedAt ?? null,
      lastAccessedAt: memory.lastAccessedAt ?? null,
    });
  }

  update(memory: LongTermMemory): void {
    this.db.prepare(`
      UPDATE long_term_memories SET
        scope = @scope,
        kind = @kind,
        state = @state,
        portability = @portability,
        title = @title,
        content = @content,
        factsJson = @factsJson,
        tagsJson = @tagsJson,
        applicability = @applicability,
        updatedAt = @updatedAt,
        qualifiedAt = @qualifiedAt,
        approvedAt = @approvedAt,
        archivedAt = @archivedAt,
        supersededBy = @supersededBy,
        lastValidatedAt = @lastValidatedAt,
        accessCount = @accessCount,
        lastAccessedAt = @lastAccessedAt
      WHERE id = @id
    `).run({
      ...memory,
      factsJson: JSON.stringify(memory.facts),
      tagsJson: JSON.stringify(memory.tags),
      applicability: memory.applicability ?? null,
      qualifiedAt: memory.qualifiedAt ?? null,
      approvedAt: memory.approvedAt ?? null,
      archivedAt: memory.archivedAt ?? null,
      supersededBy: memory.supersededBy ?? null,
      lastValidatedAt: memory.lastValidatedAt ?? null,
      lastAccessedAt: memory.lastAccessedAt ?? null,
    });
  }

  insertEvidence(input: Omit<LongTermMemoryEvidence, 'id' | 'createdAt'> & { createdAt?: string }): LongTermMemoryEvidence {
    const evidence: LongTermMemoryEvidence = {
      id: randomUUID(),
      ...input,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.db.prepare(`
      INSERT INTO long_term_memory_evidence (
        id, memoryId, kind, referenceId, relation, locator, capturedHash, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      evidence.id,
      evidence.memoryId,
      evidence.kind,
      evidence.referenceId,
      evidence.relation,
      evidence.locator ?? null,
      evidence.capturedHash ?? null,
      evidence.createdAt,
    );
    return evidence;
  }

  listEvidence(memoryId: string): LongTermMemoryEvidence[] {
    return this.db.prepare(`
      SELECT * FROM long_term_memory_evidence WHERE memoryId = ? ORDER BY createdAt ASC, id
    `).all(memoryId).map(rowToEvidence);
  }

  recordEvent(input: Omit<LongTermMemoryEvent, 'id' | 'createdAt'> & { createdAt?: string }): LongTermMemoryEvent {
    const event: LongTermMemoryEvent = {
      id: randomUUID(),
      ...input,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.db.prepare(`
      INSERT INTO long_term_memory_events (id, memoryId, kind, fromState, toState, detail, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.memoryId,
      event.kind,
      event.fromState ?? null,
      event.toState ?? null,
      event.detail ?? null,
      event.createdAt,
    );
    return event;
  }

  listEvents(memoryId: string): LongTermMemoryEvent[] {
    return this.db.prepare(`
      SELECT * FROM long_term_memory_events WHERE memoryId = ? ORDER BY createdAt ASC, rowid ASC
    `).all(memoryId).map(rowToEvent);
  }

  markAccess(ids: string[], at = new Date().toISOString()): void {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return;
    const statement = this.db.prepare(`
      UPDATE long_term_memories
      SET accessCount = accessCount + 1, lastAccessedAt = ?
      WHERE id = ?
    `);
    this.db.transaction(() => {
      for (const id of unique) statement.run(at, id);
    })();
  }

}
