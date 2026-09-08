import type { Observation } from '../types.js';

/** Rows returned by the derived FTS5 index before normal Observation parsing. */
export interface SqliteLexicalHit {
  row: Record<string, unknown>;
  score: number;
}

const ftsAvailability = new WeakMap<object, boolean>();
const FTS_TABLE = 'observations_fts';

const CREATE_OBSERVATION_FTS = `
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
  entityName,
  title,
  narrative,
  facts,
  filesModified,
  concepts,
  attachments,
  content='observations',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS observations_fts_ai AFTER INSERT ON observations BEGIN
  INSERT INTO observations_fts(rowid, entityName, title, narrative, facts, filesModified, concepts, attachments)
  VALUES (new.id, new.entityName, new.title, new.narrative, new.facts, new.filesModified, new.concepts, new.attachments);
END;

CREATE TRIGGER IF NOT EXISTS observations_fts_ad AFTER DELETE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, entityName, title, narrative, facts, filesModified, concepts, attachments)
  VALUES ('delete', old.id, old.entityName, old.title, old.narrative, old.facts, old.filesModified, old.concepts, old.attachments);
END;

CREATE TRIGGER IF NOT EXISTS observations_fts_au AFTER UPDATE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, entityName, title, narrative, facts, filesModified, concepts, attachments)
  VALUES ('delete', old.id, old.entityName, old.title, old.narrative, old.facts, old.filesModified, old.concepts, old.attachments);
  INSERT INTO observations_fts(rowid, entityName, title, narrative, facts, filesModified, concepts, attachments)
  VALUES (new.id, new.entityName, new.title, new.narrative, new.facts, new.filesModified, new.concepts, new.attachments);
END;
`;

function normalizeFtsToken(token: string): string {
  return token.replace(/"/g, '""');
}

/**
 * Turn user text into a parameterized FTS query. Every token is quoted so
 * punctuation such as `OR`, `NEAR`, and quotes remains user data.
 */
export function buildFtsQuery(query: string): string | null {
  const tokens = query.normalize('NFKC').match(/[\p{L}\p{N}_]+/gu) ?? [];
  const unique = [...new Set(tokens.map((token) => token.trim()).filter(Boolean))].slice(0, 64);
  if (unique.length === 0) return null;
  return unique.map((token) => `"${normalizeFtsToken(token)}"`).join(' OR ');
}

/**
 * Create and reconcile the external-content FTS5 index for one SQLite handle.
 * FTS5 is an optional SQLite capability, so an unavailable extension is a
 * normal fallback rather than a reason to make the durable store unusable.
 */
export function initializeObservationLexicalIndex(db: any): boolean {
  const known = ftsAvailability.get(db);
  if (known !== undefined) return known;

  try {
    db.exec(CREATE_OBSERVATION_FTS);
    const observationCount = Number(db.prepare('SELECT COUNT(*) AS count FROM observations').get()?.count ?? 0);
    const indexedCount = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${FTS_TABLE}`).get()?.count ?? 0);
    if (observationCount !== indexedCount) {
      db.exec(`INSERT INTO ${FTS_TABLE}(${FTS_TABLE}) VALUES ('rebuild')`);
    }
    ftsAvailability.set(db, true);
    return true;
  } catch (error) {
    ftsAvailability.set(db, false);
    console.warn(
      `[memorix] SQLite FTS5 unavailable; using the existing search fallback: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

export function isObservationLexicalIndexEnabled(db: any): boolean {
  return ftsAvailability.get(db) === true;
}

export function rebuildObservationLexicalIndex(db: any): boolean {
  if (!isObservationLexicalIndexEnabled(db)) return false;
  try {
    db.exec(`INSERT INTO ${FTS_TABLE}(${FTS_TABLE}) VALUES ('rebuild')`);
    return true;
  } catch {
    return false;
  }
}

export interface SqliteLexicalSearchOptions {
  query: string;
  projectId?: string | string[];
  status?: string | 'all';
  type?: string;
  source?: string;
  limit?: number;
}

/**
 * Search only the bounded lexical candidate set. The full observation body is
 * fetched from SQLite for those candidates, never by loading the corpus.
 */
export function searchObservationLexically(db: any, options: SqliteLexicalSearchOptions): SqliteLexicalHit[] {
  if (!isObservationLexicalIndexEnabled(db)) return [];
  const match = buildFtsQuery(options.query);
  if (!match) return [];

  const projectIds = options.projectId == null
    ? undefined
    : (Array.isArray(options.projectId) ? options.projectId : [options.projectId]);
  if (projectIds && projectIds.length === 0) return [];

  const where: string[] = [`${FTS_TABLE} MATCH ?`];
  const params: unknown[] = [match];
  if (projectIds) {
    where.push(`o.projectId IN (${projectIds.map(() => '?').join(', ')})`);
    params.push(...projectIds);
  }
  if (options.status && options.status !== 'all') {
    where.push('o.status = ?');
    params.push(options.status);
  }
  if (options.type) {
    where.push('o.type = ?');
    params.push(options.type);
  }
  if (options.source) {
    where.push('o.source = ?');
    params.push(options.source);
  }

  const requestedLimit = Number.isFinite(options.limit) ? Math.floor(options.limit!) : 20;
  // This is a per-query working-set guard, not a corpus limit. Large callers
  // can page or request up to 10k candidates without changing durable data.
  const limit = Math.max(1, Math.min(requestedLimit, 10_000));
  params.push(limit);

  const rows = db.prepare(`
    SELECT o.*, -bm25(${FTS_TABLE}, 2.0, 4.0, 1.0, 0.7, 0.5, 1.5, 0.5) AS lexical_score
    FROM ${FTS_TABLE}
    JOIN observations AS o ON o.id = ${FTS_TABLE}.rowid
    WHERE ${where.join(' AND ')}
    ORDER BY bm25(${FTS_TABLE}, 2.0, 4.0, 1.0, 0.7, 0.5, 1.5, 0.5) ASC, o.id DESC
    LIMIT ?
  `).all(...params) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    row,
    score: Math.max(0, Number(row.lexical_score ?? 0)),
  }));
}

/** Keep the import visible to TypeScript consumers that build store adapters. */
export type SqliteLexicalObservation = Observation;
