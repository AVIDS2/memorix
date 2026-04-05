/**
 * SqliteBackend — ObservationStore implementation backed by better-sqlite3.
 *
 * Features:
 *   - WAL mode for concurrent read performance
 *   - storage_generation counter for cross-process freshness detection
 *   - next_id counter in meta table (replaces counter.json)
 *   - One-time migration from observations.json on first init
 *   - Dynamic require of better-sqlite3 (optionalDependencies)
 *
 * Array fields (facts, filesModified, concepts, relatedCommits, relatedEntities)
 * are stored as JSON strings in SQLite columns.
 */

import type { Observation } from '../types.js';
import type { ObservationStore, StoreTransaction } from './obs-store.js';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

// Dynamic require for better-sqlite3 (native module, optionalDependencies)
let Database: any;

function loadBetterSqlite3(): any {
  if (Database) return Database;
  try {
    const require = createRequire(import.meta.url);
    Database = require('better-sqlite3');
    return Database;
  } catch {
    throw new Error('[memorix] better-sqlite3 is not available');
  }
}

// ── SQL constants ──────────────────────────────────────────────────

const CREATE_OBSERVATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS observations (
  id              INTEGER PRIMARY KEY,
  entityName      TEXT NOT NULL,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  narrative       TEXT NOT NULL DEFAULT '',
  facts           TEXT NOT NULL DEFAULT '[]',
  filesModified   TEXT NOT NULL DEFAULT '[]',
  concepts        TEXT NOT NULL DEFAULT '[]',
  tokens          INTEGER NOT NULL DEFAULT 0,
  createdAt       TEXT NOT NULL,
  updatedAt       TEXT,
  projectId       TEXT NOT NULL,
  hasCausalLanguage INTEGER DEFAULT 0,
  topicKey        TEXT,
  revisionCount   INTEGER DEFAULT 1,
  sessionId       TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  progress        TEXT,
  source          TEXT DEFAULT 'agent',
  commitHash      TEXT,
  relatedCommits  TEXT,
  relatedEntities TEXT,
  sourceDetail    TEXT,
  valueCategory   TEXT
);
`;

const CREATE_META_TABLE = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_observations_projectId ON observations(projectId);
CREATE INDEX IF NOT EXISTS idx_observations_topicKey ON observations(projectId, topicKey);
CREATE INDEX IF NOT EXISTS idx_observations_status ON observations(status);
`;

// ── Row ↔ Observation serialization ────────────────────────────────

function obsToRow(obs: Observation): Record<string, unknown> {
  return {
    id: obs.id,
    entityName: obs.entityName,
    type: obs.type,
    title: obs.title,
    narrative: obs.narrative,
    facts: JSON.stringify(obs.facts ?? []),
    filesModified: JSON.stringify(obs.filesModified ?? []),
    concepts: JSON.stringify(obs.concepts ?? []),
    tokens: obs.tokens ?? 0,
    createdAt: obs.createdAt,
    updatedAt: obs.updatedAt ?? null,
    projectId: obs.projectId,
    hasCausalLanguage: obs.hasCausalLanguage ? 1 : 0,
    topicKey: obs.topicKey ?? null,
    revisionCount: obs.revisionCount ?? 1,
    sessionId: obs.sessionId ?? null,
    status: obs.status ?? 'active',
    progress: obs.progress ? JSON.stringify(obs.progress) : null,
    source: obs.source ?? 'agent',
    commitHash: obs.commitHash ?? null,
    relatedCommits: obs.relatedCommits ? JSON.stringify(obs.relatedCommits) : null,
    relatedEntities: obs.relatedEntities ? JSON.stringify(obs.relatedEntities) : null,
    sourceDetail: obs.sourceDetail ?? null,
    valueCategory: obs.valueCategory ?? null,
  };
}

function rowToObs(row: any): Observation {
  return {
    id: row.id,
    entityName: row.entityName,
    type: row.type,
    title: row.title,
    narrative: row.narrative,
    facts: safeJsonParse(row.facts, []),
    filesModified: safeJsonParse(row.filesModified, []),
    concepts: safeJsonParse(row.concepts, []),
    tokens: row.tokens,
    createdAt: row.createdAt,
    ...(row.updatedAt ? { updatedAt: row.updatedAt } : {}),
    projectId: row.projectId,
    hasCausalLanguage: !!row.hasCausalLanguage,
    ...(row.topicKey ? { topicKey: row.topicKey } : {}),
    revisionCount: row.revisionCount ?? 1,
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    status: row.status ?? 'active',
    ...(row.progress ? { progress: safeJsonParse(row.progress, undefined) } : {}),
    ...(row.source ? { source: row.source } : {}),
    ...(row.commitHash ? { commitHash: row.commitHash } : {}),
    ...(row.relatedCommits ? { relatedCommits: safeJsonParse(row.relatedCommits, []) } : {}),
    ...(row.relatedEntities ? { relatedEntities: safeJsonParse(row.relatedEntities, []) } : {}),
    ...(row.sourceDetail ? { sourceDetail: row.sourceDetail } : {}),
    ...(row.valueCategory ? { valueCategory: row.valueCategory } : {}),
  } as Observation;
}

function safeJsonParse(val: string | null | undefined, fallback: any): any {
  if (val == null || val === '') return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ── SqliteBackend ──────────────────────────────────────────────────

export class SqliteBackend implements ObservationStore {
  private db: any = null;
  private dataDir: string = '';
  private knownGeneration: number = 0;

  // Async mutex for serializing atomic() calls on the single connection
  private _atomicQueue: Promise<unknown> = Promise.resolve();

  // Prepared statements (lazy-initialized after db open)
  private stmtInsert: any = null;
  private stmtUpdate: any = null;
  private stmtDelete: any = null;
  private stmtSelectAll: any = null;
  private stmtSelectGeneration: any = null;
  private stmtBumpGeneration: any = null;
  private stmtGetMeta: any = null;
  private stmtSetMeta: any = null;

  async init(dataDir: string): Promise<void> {
    this.dataDir = dataDir;
    const BetterSqlite3 = loadBetterSqlite3();

    const dbPath = path.join(dataDir, 'memorix.db');
    fs.mkdirSync(dataDir, { recursive: true });

    this.db = new BetterSqlite3(dbPath);

    // WAL mode for concurrent reads
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');

    // Create schema
    this.db.exec(CREATE_OBSERVATIONS_TABLE);
    this.db.exec(CREATE_META_TABLE);
    this.db.exec(CREATE_INDEXES);

    // Seed meta defaults
    this.db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('storage_generation', '0')`).run();
    this.db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('next_id', '1')`).run();

    // Prepare statements
    this.stmtInsert = this.db.prepare(`
      INSERT OR REPLACE INTO observations
        (id, entityName, type, title, narrative, facts, filesModified, concepts, tokens,
         createdAt, updatedAt, projectId, hasCausalLanguage, topicKey, revisionCount,
         sessionId, status, progress, source, commitHash, relatedCommits, relatedEntities,
         sourceDetail, valueCategory)
      VALUES
        (@id, @entityName, @type, @title, @narrative, @facts, @filesModified, @concepts, @tokens,
         @createdAt, @updatedAt, @projectId, @hasCausalLanguage, @topicKey, @revisionCount,
         @sessionId, @status, @progress, @source, @commitHash, @relatedCommits, @relatedEntities,
         @sourceDetail, @valueCategory)
    `);
    this.stmtUpdate = this.stmtInsert; // INSERT OR REPLACE works for both
    this.stmtDelete = this.db.prepare(`DELETE FROM observations WHERE id = ?`);
    this.stmtSelectAll = this.db.prepare(`SELECT * FROM observations`);
    this.stmtSelectGeneration = this.db.prepare(`SELECT value FROM meta WHERE key = 'storage_generation'`);
    this.stmtBumpGeneration = this.db.prepare(`UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'storage_generation'`);
    this.stmtGetMeta = this.db.prepare(`SELECT value FROM meta WHERE key = ?`);
    this.stmtSetMeta = this.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`);

    // Read initial generation
    this.knownGeneration = this.readGeneration();

    // Migration: if observations table is empty but observations.json exists, import
    await this.migrateFromJsonIfNeeded();
  }

  // ── Internal helpers ─────────────────────────────────────────────

  private readGeneration(): number {
    const row = this.stmtSelectGeneration.get();
    return row ? parseInt(row.value, 10) : 0;
  }

  private bumpGeneration(): void {
    this.stmtBumpGeneration.run();
    this.knownGeneration = this.readGeneration();
  }

  private rawLoadAll(): Observation[] {
    const rows = this.stmtSelectAll.all();
    return rows.map(rowToObs);
  }

  private rawLoadIdCounter(): number {
    const row = this.stmtGetMeta.get('next_id');
    return row ? parseInt(row.value, 10) : 1;
  }

  private rawSaveIdCounter(nextId: number): void {
    this.stmtSetMeta.run('next_id', String(nextId));
  }

  // ── Migration ────────────────────────────────────────────────────

  private async migrateFromJsonIfNeeded(): Promise<void> {
    // Only migrate if table is empty
    const count = this.db.prepare(`SELECT COUNT(*) AS cnt FROM observations`).get();
    if (count.cnt > 0) return;

    const jsonPath = path.join(this.dataDir, 'observations.json');
    if (!fs.existsSync(jsonPath)) return;

    try {
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const observations: Observation[] = JSON.parse(raw);

      if (observations.length === 0) return;

      console.error(`[memorix] Migrating ${observations.length} observations from JSON to SQLite...`);

      const insertMany = this.db.transaction((obsList: Observation[]) => {
        for (const obs of obsList) {
          this.stmtInsert.run(obsToRow(obs));
        }
      });
      insertMany(observations);

      // Migrate counter
      const counterPath = path.join(this.dataDir, 'counter.json');
      if (fs.existsSync(counterPath)) {
        try {
          const counterData = JSON.parse(fs.readFileSync(counterPath, 'utf-8'));
          const nextId = counterData.nextId ?? counterData.next_id ?? (Math.max(...observations.map(o => o.id)) + 1);
          this.rawSaveIdCounter(nextId);
        } catch {
          // Fallback: derive from max observation ID
          this.rawSaveIdCounter(Math.max(...observations.map(o => o.id)) + 1);
        }
      } else {
        this.rawSaveIdCounter(Math.max(...observations.map(o => o.id)) + 1);
      }

      this.bumpGeneration();

      console.error(`[memorix] Migration complete. ${observations.length} observations now in SQLite.`);
    } catch (err) {
      console.error(`[memorix] JSON→SQLite migration failed (non-fatal, data preserved in JSON): ${err}`);
    }
  }

  // ── Public read ──────────────────────────────────────────────────

  async loadAll(): Promise<Observation[]> {
    return this.rawLoadAll();
  }

  async loadIdCounter(): Promise<number> {
    return this.rawLoadIdCounter();
  }

  // ── Public write (each bumps generation) ─────────────────────────

  async insert(obs: Observation): Promise<void> {
    this.stmtInsert.run(obsToRow(obs));
    this.bumpGeneration();
  }

  async update(obs: Observation): Promise<void> {
    this.stmtUpdate.run(obsToRow(obs));
    this.bumpGeneration();
  }

  async remove(id: number): Promise<void> {
    this.stmtDelete.run(id);
    this.bumpGeneration();
  }

  async bulkReplace(obs: Observation[]): Promise<void> {
    const run = this.db.transaction((obsList: Observation[]) => {
      this.db.prepare(`DELETE FROM observations`).run();
      for (const o of obsList) {
        this.stmtInsert.run(obsToRow(o));
      }
    });
    run(obs);
    this.bumpGeneration();
  }

  async bulkRemoveByIds(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const run = this.db.transaction((idList: number[]) => {
      const stmt = this.db.prepare(`DELETE FROM observations WHERE id = ?`);
      for (const id of idList) {
        stmt.run(id);
      }
    });
    run(ids);
    this.bumpGeneration();
  }

  async saveIdCounter(nextId: number): Promise<void> {
    this.rawSaveIdCounter(nextId);
  }

  // ── Compound atomic operation ────────────────────────────────────

  async atomic<T>(fn: (tx: StoreTransaction) => Promise<T>): Promise<T> {
    // Serialize concurrent atomic() calls via an async queue.
    // better-sqlite3 is single-connection; nested BEGIN is illegal.
    return new Promise<T>((resolve, reject) => {
      this._atomicQueue = this._atomicQueue.then(async () => {
        this.db.prepare('BEGIN IMMEDIATE').run();
        try {
          const tx: StoreTransaction = {
            loadAll: async () => this.rawLoadAll(),
            loadIdCounter: async () => this.rawLoadIdCounter(),
            saveAll: async (obs) => {
              this.db.prepare(`DELETE FROM observations`).run();
              for (const o of obs) {
                this.stmtInsert.run(obsToRow(o));
              }
            },
            saveIdCounter: async (nextId) => this.rawSaveIdCounter(nextId),
          };
          const result = await fn(tx);
          this.bumpGeneration();
          this.db.prepare('COMMIT').run();
          resolve(result);
        } catch (err) {
          try { this.db.prepare('ROLLBACK').run(); } catch { /* already rolled back */ }
          reject(err);
        }
      });
    });
  }

  // ── Freshness ────────────────────────────────────────────────────

  async ensureFresh(): Promise<boolean> {
    const remoteGen = this.readGeneration();
    if (remoteGen > this.knownGeneration) {
      this.knownGeneration = remoteGen;
      return true; // caller should reload observations[] + rebuild Orama
    }
    return false;
  }

  getGeneration(): number {
    return this.knownGeneration;
  }

  // ── Diagnostics ──────────────────────────────────────────────────

  close(): void {
    if (this.db) {
      try { this.db.close(); } catch { /* best-effort */ }
      this.db = null;
    }
  }

  getBackendName(): 'sqlite' | 'json' {
    return 'sqlite';
  }
}
