/**
 * SessionStore — persistence abstraction for coding sessions.
 *
 * Backends:
 *   - SessionSqliteStore — canonical store, uses shared DB handle from sqlite-db.ts
 *   - SessionGracefulDegrade — no-op fallback when SQLite is unavailable
 *
 * Phase 2 debt-zero: SQLite is the only canonical store for sessions.
 * JSON files are migration source only. No writable JSON fallback exists.
 */

import type { Session } from '../types.js';
import { getDatabase } from './sqlite-db.js';
import { loadSessionsJson } from './persistence.js';
import path from 'node:path';
import fs from 'node:fs';

// ── Interface ───────────────────────────────────────────────────────

export interface SessionStoreInterface {
  init(dataDir: string): Promise<void>;
  loadAll(): Promise<Session[]>;
  loadByProject(projectId: string): Promise<Session[]>;
  loadActive(projectId: string): Promise<Session[]>;
  insert(session: Session): Promise<void>;
  update(session: Session): Promise<void>;
  bulkUpdate(sessions: Session[]): Promise<void>;
  /**
   * Atomic rollover: complete all active sessions for the given project IDs
   * and insert a new active session in a single transaction.
   * Guarantees at most one active session per project.
   */
  atomicRolloverInsert(newSession: Session, projectIds: string[], now: string): Promise<number>;
  getBackendName(): 'sqlite' | 'json';
}

// ── Row <-> Session serialization ───────────────────────────────────

function sessionToRow(session: Session): Record<string, unknown> {
  return {
    id: session.id,
    projectId: session.projectId,
    startedAt: session.startedAt,
    endedAt: session.endedAt ?? null,
    status: session.status,
    summary: session.summary ?? null,
    agent: session.agent ?? null,
  };
}

function rowToSession(row: any): Session {
  return {
    id: row.id,
    projectId: row.projectId,
    startedAt: row.startedAt,
    ...(row.endedAt ? { endedAt: row.endedAt } : {}),
    status: row.status ?? 'active',
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.agent ? { agent: row.agent } : {}),
  };
}

// ── SQLite Backend ──────────────────────────────────────────────────

export class SessionSqliteStore implements SessionStoreInterface {
  private db: any = null;
  private dataDir: string = '';

  private stmtInsert: any = null;
  private stmtSelectAll: any = null;
  private stmtSelectByProject: any = null;
  private stmtSelectActive: any = null;
  private _stmtCompleteActive: any = null;

  async init(dataDir: string): Promise<void> {
    this.dataDir = dataDir;
    this.db = getDatabase(dataDir);

    // Prepare statements
    this.stmtInsert = this.db.prepare(`
      INSERT OR REPLACE INTO sessions
        (id, projectId, startedAt, endedAt, status, summary, agent)
      VALUES
        (@id, @projectId, @startedAt, @endedAt, @status, @summary, @agent)
    `);
    this.stmtSelectAll = this.db.prepare(`SELECT * FROM sessions ORDER BY startedAt DESC`);
    this.stmtSelectByProject = this.db.prepare(`SELECT * FROM sessions WHERE projectId = ? ORDER BY startedAt DESC`);
    this.stmtSelectActive = this.db.prepare(`SELECT * FROM sessions WHERE projectId = ? AND status = 'active' ORDER BY startedAt DESC`);

    // One-time migration from sessions.json
    await this.migrateFromJsonIfNeeded();
  }

  // ── Migration ────────────────────────────────────────────────────

  private async migrateFromJsonIfNeeded(): Promise<void> {
    const count = this.db.prepare(`SELECT COUNT(*) AS cnt FROM sessions`).get();
    if (count.cnt > 0) return;

    const jsonPath = path.join(this.dataDir, 'sessions.json');
    if (!fs.existsSync(jsonPath)) return;

    try {
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const sessions: Session[] = JSON.parse(raw);
      if (!Array.isArray(sessions) || sessions.length === 0) return;

      console.error(`[memorix] Migrating ${sessions.length} sessions from JSON to SQLite...`);

      const insertMany = this.db.transaction((list: Session[]) => {
        for (const s of list) {
          this.stmtInsert.run(sessionToRow(s));
        }
      });
      insertMany(sessions);

      console.error(`[memorix] Sessions migration complete. ${sessions.length} sessions now in SQLite.`);
    } catch (err) {
      console.error(`[memorix] Sessions JSON->SQLite migration failed (non-fatal): ${err}`);
    }
  }

  // ── Public read ──────────────────────────────────────────────────

  async loadAll(): Promise<Session[]> {
    return this.stmtSelectAll.all().map(rowToSession);
  }

  async loadByProject(projectId: string): Promise<Session[]> {
    return this.stmtSelectByProject.all(projectId).map(rowToSession);
  }

  async loadActive(projectId: string): Promise<Session[]> {
    return this.stmtSelectActive.all(projectId).map(rowToSession);
  }

  // ── Public write ─────────────────────────────────────────────────

  async insert(session: Session): Promise<void> {
    this.stmtInsert.run(sessionToRow(session));
  }

  async update(session: Session): Promise<void> {
    this.stmtInsert.run(sessionToRow(session)); // INSERT OR REPLACE
  }

  async bulkUpdate(sessions: Session[]): Promise<void> {
    const run = this.db.transaction((list: Session[]) => {
      for (const s of list) {
        this.stmtInsert.run(sessionToRow(s));
      }
    });
    run(sessions);
  }

  /**
   * Atomic rollover: complete all active sessions for the given project IDs
   * and insert a new active session in a single SQLite transaction.
   * SQLite serializes write transactions, so concurrent calls are safely sequenced.
   */
  async atomicRolloverInsert(newSession: Session, projectIds: string[], now: string): Promise<number> {
    if (!this._stmtCompleteActive) {
      this._stmtCompleteActive = this.db.prepare(
        `UPDATE sessions SET status = 'completed', endedAt = @now, summary = COALESCE(NULLIF(summary, ''), '(session ended implicitly by new session start)') WHERE projectId = @pid AND status = 'active'`
      );
    }
    const stmtComplete = this._stmtCompleteActive;
    const stmtIns = this.stmtInsert;

    const result = this.db.transaction(() => {
      let completedCount = 0;
      for (const pid of projectIds) {
        const info = stmtComplete.run({ pid, now });
        completedCount += info.changes;
      }
      stmtIns.run(sessionToRow(newSession));
      return completedCount;
    })();
    return result;
  }

  getBackendName(): 'sqlite' | 'json' {
    return 'sqlite';
  }
}

// ── Graceful Degrade Fallback ────────────────────────────────────────
//
// Phase 2 debt-zero rule: sessions have NO writable JSON fallback.
// In JSON-only environments (no better-sqlite3), reads return empty
// and writes are no-ops with a warning.

export class SessionGracefulDegrade implements SessionStoreInterface {
  private warned = false;

  private warn(): void {
    if (!this.warned) {
      console.error('[memorix] SessionStore: SQLite unavailable — sessions are disabled (read-only empty). Install better-sqlite3 for full functionality.');
      this.warned = true;
    }
  }

  async init(_dataDir: string): Promise<void> {
    this.warn();
  }

  async loadAll(): Promise<Session[]> { return []; }
  async loadByProject(_projectId: string): Promise<Session[]> { return []; }
  async loadActive(_projectId: string): Promise<Session[]> { return []; }

  async insert(_session: Session): Promise<void> { this.warn(); }
  async update(_session: Session): Promise<void> { this.warn(); }
  async bulkUpdate(_sessions: Session[]): Promise<void> { this.warn(); }
  async atomicRolloverInsert(_newSession: Session, _projectIds: string[], _now: string): Promise<number> { this.warn(); return 0; }

  getBackendName(): 'sqlite' | 'json' { return 'json'; }
}

// ── Singleton access ────────────────────────────────────────────────

let _store: SessionStoreInterface | null = null;
let _storeDataDir: string | null = null;

export function getSessionStore(): SessionStoreInterface {
  if (!_store) {
    throw new Error('[memorix] SessionStore not initialized — call initSessionStore() first');
  }
  return _store;
}

export function resetSessionStore(): void {
  _store = null;
  _storeDataDir = null;
}

export async function initSessionStore(dataDir: string): Promise<SessionStoreInterface> {
  if (_store && _storeDataDir === dataDir) return _store;

  _store = null;
  _storeDataDir = null;

  // Try SQLite first
  try {
    const store = new SessionSqliteStore();
    await store.init(dataDir);
    _store = store;
    _storeDataDir = dataDir;
    return store;
  } catch (err) {
    console.error(`[memorix] SessionSqliteStore unavailable, falling back to JSON: ${err instanceof Error ? err.message : err}`);
  }

  // Fallback: graceful degrade (no writable JSON backend per debt-zero rule)
  const store = new SessionGracefulDegrade();
  await store.init(dataDir);
  _store = store;
  _storeDataDir = dataDir;
  return store;
}
