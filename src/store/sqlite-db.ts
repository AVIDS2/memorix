/**
 * Shared SQLite Database Handle
 *
 * Provides a singleton-per-dataDir better-sqlite3 connection shared across
 * all SQLite-backed stores (observations, mini-skills, sessions).
 *
 * Responsibilities:
 *   - Dynamic require of better-sqlite3 (optionalDependencies)
 *   - WAL mode and busy_timeout configuration
 *   - Schema creation for ALL tables (observations, mini_skills, sessions, meta)
 *   - Singleton caching per dataDir
 *   - Graceful close
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

// Dynamic require for better-sqlite3 (native module, optionalDependencies)
let BetterSqlite3: any;

export function loadBetterSqlite3(): any {
  if (BetterSqlite3) return BetterSqlite3;
  try {
    const require = createRequire(import.meta.url);
    BetterSqlite3 = require('better-sqlite3');
    return BetterSqlite3;
  } catch {
    throw new Error('[memorix] better-sqlite3 is not available');
  }
}

// ── Schema DDL ──────────────────────────────────────────────────────

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

const CREATE_MINI_SKILLS_TABLE = `
CREATE TABLE IF NOT EXISTS mini_skills (
  id                   INTEGER PRIMARY KEY,
  sourceObservationIds TEXT NOT NULL DEFAULT '[]',
  sourceEntity         TEXT NOT NULL DEFAULT 'unknown',
  title                TEXT NOT NULL,
  instruction          TEXT NOT NULL DEFAULT '',
  trigger_desc         TEXT NOT NULL DEFAULT '',
  facts                TEXT NOT NULL DEFAULT '[]',
  projectId            TEXT NOT NULL,
  createdAt            TEXT NOT NULL,
  usedCount            INTEGER NOT NULL DEFAULT 0,
  tags                 TEXT NOT NULL DEFAULT '[]'
);
`;

const CREATE_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  projectId  TEXT NOT NULL,
  startedAt  TEXT NOT NULL,
  endedAt    TEXT,
  status     TEXT NOT NULL DEFAULT 'active',
  summary    TEXT,
  agent      TEXT
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
CREATE INDEX IF NOT EXISTS idx_mini_skills_projectId ON mini_skills(projectId);
CREATE INDEX IF NOT EXISTS idx_sessions_projectId ON sessions(projectId);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(projectId, status);
`;

// ── Singleton cache ─────────────────────────────────────────────────

const _dbCache = new Map<string, any>();

/**
 * Get or create a shared better-sqlite3 database handle for the given data directory.
 *
 * The handle is cached per normalized dataDir path. All stores (observations,
 * mini-skills, sessions) share the same connection and the same DB file.
 *
 * Callers must NOT close the returned handle directly — use closeDatabase().
 */
export function getDatabase(dataDir: string): any {
  const normalized = path.resolve(dataDir);
  const existing = _dbCache.get(normalized);
  if (existing) return existing;

  const DB = loadBetterSqlite3();
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'memorix.db');
  const db = new DB(dbPath);

  // WAL mode for concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  // Create all tables
  db.exec(CREATE_OBSERVATIONS_TABLE);
  db.exec(CREATE_MINI_SKILLS_TABLE);
  db.exec(CREATE_SESSIONS_TABLE);
  db.exec(CREATE_META_TABLE);
  db.exec(CREATE_INDEXES);

  // Phase 3a migration: add sourceSnapshot + updatedAt to mini_skills
  // Idempotent — ALTER TABLE ADD COLUMN throws if column already exists
  try { db.exec(`ALTER TABLE mini_skills ADD COLUMN sourceSnapshot TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE mini_skills ADD COLUMN updatedAt TEXT`); } catch { /* already exists */ }

  // Seed meta defaults
  db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('storage_generation', '0')`).run();
  db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('next_id', '1')`).run();
  db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('mini_skills_generation', '0')`).run();

  _dbCache.set(normalized, db);
  return db;
}

/**
 * Close and remove a cached database handle for the given data directory.
 * Safe to call even if no handle exists.
 */
export function closeDatabase(dataDir: string): void {
  const normalized = path.resolve(dataDir);
  const db = _dbCache.get(normalized);
  if (db) {
    try { db.close(); } catch { /* best-effort */ }
    _dbCache.delete(normalized);
  }
}

/**
 * Close all cached database handles. Used during shutdown or tests.
 */
export function closeAllDatabases(): void {
  for (const [key, db] of _dbCache) {
    try { db.close(); } catch { /* best-effort */ }
    _dbCache.delete(key);
  }
}

/**
 * Check if better-sqlite3 is available without throwing.
 */
export function isSqliteAvailable(): boolean {
  try {
    loadBetterSqlite3();
    return true;
  } catch {
    return false;
  }
}
