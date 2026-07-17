/**
 * Shared SQLite Database Handle
 *
 * Provides a singleton-per-dataDir better-sqlite3 connection shared across
 * all SQLite-backed stores (observations, mini-skills, sessions, team).
 *
 * Responsibilities:
 *   - Dynamic require of better-sqlite3 (optionalDependencies)
 *   - WAL mode and busy_timeout configuration
 *   - Schema creation for ALL tables (observations, mini_skills, sessions, meta, team_*)
 *   - Singleton caching per dataDir
 *   - Graceful close
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { createDatabase, loadSqlite } from './bun-sqlite-compat.js';

// Dynamic require for SQLite (better-sqlite3 or bun:sqlite)
let BetterSqlite3: any;

export function loadBetterSqlite3(): any {
  if (BetterSqlite3) return BetterSqlite3;
  try {
    BetterSqlite3 = loadSqlite();
    return BetterSqlite3;
  } catch {
    throw new Error('[memorix] SQLite is not available (neither better-sqlite3 nor bun:sqlite)');
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

// ── Phase 4a: Orchestration Coordination Tables ─────────────────────

const CREATE_TEAM_AGENTS_TABLE = `
CREATE TABLE IF NOT EXISTS team_agents (
  agent_id        TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  agent_type      TEXT NOT NULL,
  instance_id     TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  role            TEXT,
  capabilities    TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  joined_at       INTEGER NOT NULL,
  last_heartbeat  INTEGER NOT NULL,
  left_at         INTEGER,
  last_seen_obs_generation INTEGER NOT NULL DEFAULT 0,
  UNIQUE(project_id, agent_type, instance_id)
);
`;

const CREATE_TEAM_MESSAGES_TABLE = `
CREATE TABLE IF NOT EXISTS team_messages (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  sender_agent_id TEXT NOT NULL,
  recipient_agent_id TEXT,
  type            TEXT NOT NULL DEFAULT 'direct',
  content         TEXT NOT NULL DEFAULT '',
  payload         TEXT,
  task_id         TEXT,
  read_at         INTEGER,
  created_at      INTEGER NOT NULL,
  to_role         TEXT,
  handoff_status  TEXT,
  FOREIGN KEY (sender_agent_id) REFERENCES team_agents(agent_id),
  FOREIGN KEY (task_id) REFERENCES team_tasks(task_id)
);
`;

const CREATE_TEAM_TASKS_TABLE = `
CREATE TABLE IF NOT EXISTS team_tasks (
  task_id         TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  description     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  assignee_agent_id TEXT,
  result          TEXT,
  metadata        TEXT,
  created_by      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  required_role   TEXT,
  preferred_role  TEXT,
  FOREIGN KEY (assignee_agent_id) REFERENCES team_agents(agent_id),
  FOREIGN KEY (created_by) REFERENCES team_agents(agent_id)
);
`;

const CREATE_TEAM_TASK_DEPS_TABLE = `
CREATE TABLE IF NOT EXISTS team_task_deps (
  task_id     TEXT NOT NULL,
  dep_task_id TEXT NOT NULL,
  PRIMARY KEY (task_id, dep_task_id),
  FOREIGN KEY (task_id) REFERENCES team_tasks(task_id),
  FOREIGN KEY (dep_task_id) REFERENCES team_tasks(task_id)
);
`;

const CREATE_TEAM_LOCKS_TABLE = `
CREATE TABLE IF NOT EXISTS team_locks (
  file            TEXT NOT NULL,
  project_id      TEXT NOT NULL,
  locked_by       TEXT NOT NULL,
  locked_at       INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  PRIMARY KEY (file, project_id),
  FOREIGN KEY (locked_by) REFERENCES team_agents(agent_id)
);
`;

// ── Phase 4d: Role-based Coordination Tables ─────────────────────────

const CREATE_TEAM_ROLES_TABLE = `
CREATE TABLE IF NOT EXISTS team_roles (
  role_id               TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL,
  label                 TEXT NOT NULL,
  description           TEXT,
  preferred_agent_types TEXT NOT NULL DEFAULT '[]',
  max_concurrent        INTEGER NOT NULL DEFAULT 1,
  created_at            INTEGER NOT NULL
);
`;

// ── Chat Transcript Table ──────────────────────────────────────────────

const CREATE_CHAT_TRANSCRIPT_TABLE = `
CREATE TABLE IF NOT EXISTS chat_transcript (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      TEXT NOT NULL,
  thread_id       TEXT NOT NULL DEFAULT 'default',
  role            TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  sources_json    TEXT NOT NULL DEFAULT '[]',
  meta_json       TEXT NOT NULL DEFAULT '{}',
  error           INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
`;

// ── Knowledge Graph Tables ────────────────────────────────────────────

const CREATE_GRAPH_ENTITIES_TABLE = `
CREATE TABLE IF NOT EXISTS graph_entities (
  name            TEXT PRIMARY KEY,
  entityType      TEXT NOT NULL DEFAULT '',
  observations    TEXT NOT NULL DEFAULT '[]'
);
`;

const CREATE_GRAPH_RELATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS graph_relations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  from_entity     TEXT NOT NULL,
  to_entity       TEXT NOT NULL,
  relationType    TEXT NOT NULL DEFAULT '',
  UNIQUE(from_entity, to_entity, relationType)
);
`;

// ── CodeGraph Memory Tables ─────────────────────────────────────────

const CREATE_CODE_FILES_TABLE = `
CREATE TABLE IF NOT EXISTS code_files (
  id              TEXT PRIMARY KEY,
  projectId       TEXT NOT NULL,
  path            TEXT NOT NULL,
  language        TEXT,
  contentHash     TEXT NOT NULL,
  mtimeMs         INTEGER,
  sizeBytes       INTEGER,
  indexedAt       TEXT NOT NULL,
  gitCommit       TEXT,
  UNIQUE(projectId, path)
);
`;

const CREATE_CODE_SYMBOLS_TABLE = `
CREATE TABLE IF NOT EXISTS code_symbols (
  id              TEXT PRIMARY KEY,
  projectId       TEXT NOT NULL,
  fileId          TEXT NOT NULL,
  path            TEXT NOT NULL,
  name            TEXT NOT NULL,
  qualifiedName   TEXT NOT NULL,
  kind            TEXT NOT NULL,
  startLine       INTEGER,
  endLine         INTEGER,
  signature       TEXT,
  contentHash     TEXT,
  indexedAt       TEXT NOT NULL,
  stale           INTEGER NOT NULL DEFAULT 0,
  UNIQUE(projectId, fileId, qualifiedName, kind)
);
`;

const CREATE_CODE_EDGES_TABLE = `
CREATE TABLE IF NOT EXISTS code_edges (
  id              TEXT PRIMARY KEY,
  projectId       TEXT NOT NULL,
  fromSymbolId    TEXT,
  toSymbolId      TEXT,
  fromFileId      TEXT,
  toFileId        TEXT,
  type            TEXT NOT NULL,
  confidence      REAL NOT NULL DEFAULT 1.0,
  evidence        TEXT,
  indexedAt       TEXT NOT NULL
);
`;

const CREATE_OBSERVATION_CODE_REFS_TABLE = `
CREATE TABLE IF NOT EXISTS observation_code_refs (
  id                 TEXT PRIMARY KEY,
  projectId          TEXT NOT NULL,
  observationId      INTEGER NOT NULL,
  fileId             TEXT,
  symbolId           TEXT,
  capturedFileHash   TEXT,
  capturedSymbolHash TEXT,
  status             TEXT NOT NULL,
  reason             TEXT,
  createdAt          TEXT NOT NULL,
  updatedAt          TEXT
);
`;

const CREATE_SCHEMA_MIGRATIONS_TABLE = [
  'CREATE TABLE IF NOT EXISTS schema_migrations (',
  '  id TEXT PRIMARY KEY,',
  '  applied_at TEXT NOT NULL',
  ');',
].join('\n');

const CREATE_CODE_STATE_SNAPSHOTS_TABLE = [
  'CREATE TABLE IF NOT EXISTS code_state_snapshots (',
  '  id                   TEXT PRIMARY KEY,',
  '  projectId            TEXT NOT NULL,',
  '  provider             TEXT NOT NULL,',
  '  baseRevision         TEXT,',
  '  worktreeFingerprint  TEXT NOT NULL,',
  '  worktreeState        TEXT NOT NULL,',
  '  changedPathCount     INTEGER NOT NULL DEFAULT 0,',
  '  indexedAt            TEXT NOT NULL,',
  '  sourceEpoch          INTEGER NOT NULL,',
  "  completenessJson     TEXT NOT NULL DEFAULT '{}',",
  '  previousSnapshotId   TEXT,',
  '  UNIQUE(projectId, sourceEpoch)',
  ');',
].join('\n');

// ── 1.2 Knowledge Claim Ledger ──────────────────────────────────────

const CREATE_KNOWLEDGE_CLAIMS_TABLE = `
CREATE TABLE IF NOT EXISTS knowledge_claims (
  id              TEXT PRIMARY KEY,
  projectId       TEXT NOT NULL,
  subject         TEXT NOT NULL,
  predicate       TEXT NOT NULL,
  objectValue     TEXT NOT NULL,
  scope           TEXT NOT NULL,
  claimKey        TEXT NOT NULL,
  conflictKey     TEXT NOT NULL,
  status          TEXT NOT NULL,
  confidence      REAL NOT NULL,
  observedAt      TEXT NOT NULL,
  validFrom       TEXT,
  validTo         TEXT,
  supersededBy    TEXT,
  reviewState     TEXT NOT NULL,
  origin          TEXT NOT NULL,
  createdAt       TEXT NOT NULL,
  updatedAt       TEXT NOT NULL
);
`;

const CREATE_KNOWLEDGE_CLAIM_EVIDENCE_TABLE = `
CREATE TABLE IF NOT EXISTS knowledge_claim_evidence (
  id              TEXT PRIMARY KEY,
  claimId         TEXT NOT NULL,
  evidenceKind    TEXT NOT NULL,
  evidenceId      TEXT NOT NULL,
  relation        TEXT NOT NULL,
  snapshotId      TEXT,
  locator         TEXT,
  capturedHash    TEXT,
  evidenceKey     TEXT NOT NULL,
  createdAt       TEXT NOT NULL,
  UNIQUE(claimId, evidenceKey),
  FOREIGN KEY (claimId) REFERENCES knowledge_claims(id) ON DELETE CASCADE
);
`;

const CREATE_KNOWLEDGE_CLAIM_EVENTS_TABLE = `
CREATE TABLE IF NOT EXISTS knowledge_claim_events (
  id              TEXT PRIMARY KEY,
  projectId       TEXT NOT NULL,
  claimId         TEXT NOT NULL,
  kind            TEXT NOT NULL,
  fromStatus      TEXT,
  toStatus        TEXT,
  relatedClaimId  TEXT,
  detail          TEXT,
  createdAt       TEXT NOT NULL,
  FOREIGN KEY (claimId) REFERENCES knowledge_claims(id) ON DELETE CASCADE
);
`;

// ── Runtime maintenance jobs ───────────────────────────────────────

const CREATE_MAINTENANCE_JOBS_TABLE = `
CREATE TABLE IF NOT EXISTS maintenance_jobs (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL,
  kind             TEXT NOT NULL,
  dedupe_key       TEXT NOT NULL,
  payload_json     TEXT NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'pending',
  attempts         INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 8,
  run_after        INTEGER NOT NULL,
  lease_owner      TEXT,
  lease_expires_at INTEGER,
  last_error       TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  completed_at     INTEGER
);
`;

const CREATE_MAINTENANCE_TARGETS_TABLE = `
CREATE TABLE IF NOT EXISTS maintenance_targets (
  project_id   TEXT PRIMARY KEY,
  project_root TEXT NOT NULL,
  data_dir     TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);
`;

const CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_observations_projectId ON observations(projectId);
CREATE INDEX IF NOT EXISTS idx_observations_topicKey ON observations(projectId, topicKey);
CREATE INDEX IF NOT EXISTS idx_observations_status ON observations(status);
CREATE INDEX IF NOT EXISTS idx_observations_project_status_id ON observations(projectId, status, id);
CREATE INDEX IF NOT EXISTS idx_mini_skills_projectId ON mini_skills(projectId);
CREATE INDEX IF NOT EXISTS idx_sessions_projectId ON sessions(projectId);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(projectId, status);
CREATE INDEX IF NOT EXISTS idx_team_agents_project ON team_agents(project_id, status);
CREATE INDEX IF NOT EXISTS idx_team_messages_recipient ON team_messages(recipient_agent_id, read_at);
CREATE INDEX IF NOT EXISTS idx_team_messages_project ON team_messages(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_team_tasks_project ON team_tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_team_tasks_assignee ON team_tasks(assignee_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_team_locks_project ON team_locks(project_id);
CREATE INDEX IF NOT EXISTS idx_team_roles_project ON team_roles(project_id);
CREATE INDEX IF NOT EXISTS idx_team_tasks_role ON team_tasks(required_role);
CREATE INDEX IF NOT EXISTS idx_team_messages_role ON team_messages(to_role);
CREATE INDEX IF NOT EXISTS idx_graph_relations_from ON graph_relations(from_entity);
CREATE INDEX IF NOT EXISTS idx_graph_relations_to ON graph_relations(to_entity);
CREATE INDEX IF NOT EXISTS idx_chat_transcript_project ON chat_transcript(project_id, thread_id);
CREATE INDEX IF NOT EXISTS idx_code_files_project ON code_files(projectId);
CREATE INDEX IF NOT EXISTS idx_code_symbols_project_name ON code_symbols(projectId, name);
CREATE INDEX IF NOT EXISTS idx_code_symbols_file ON code_symbols(fileId);
CREATE INDEX IF NOT EXISTS idx_code_edges_project ON code_edges(projectId, type);
CREATE INDEX IF NOT EXISTS idx_code_snapshots_project_epoch ON code_state_snapshots(projectId, sourceEpoch DESC);
CREATE INDEX IF NOT EXISTS idx_code_files_snapshot ON code_files(projectId, snapshotId);
CREATE INDEX IF NOT EXISTS idx_code_symbols_snapshot ON code_symbols(projectId, snapshotId);
CREATE INDEX IF NOT EXISTS idx_code_edges_snapshot ON code_edges(projectId, snapshotId);
CREATE INDEX IF NOT EXISTS idx_observation_code_refs_obs ON observation_code_refs(projectId, observationId);
CREATE INDEX IF NOT EXISTS idx_observation_code_refs_status ON observation_code_refs(projectId, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_claims_project_status ON knowledge_claims(projectId, status, updatedAt DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_claims_project_conflict ON knowledge_claims(projectId, conflictKey, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_claims_project_key ON knowledge_claims(projectId, claimKey, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_claim_evidence_claim ON knowledge_claim_evidence(claimId, createdAt);
CREATE INDEX IF NOT EXISTS idx_knowledge_claim_events_claim ON knowledge_claim_events(claimId, createdAt);
CREATE INDEX IF NOT EXISTS idx_maintenance_jobs_ready ON maintenance_jobs(status, run_after);
CREATE INDEX IF NOT EXISTS idx_maintenance_jobs_project ON maintenance_jobs(project_id, status, run_after);
CREATE INDEX IF NOT EXISTS idx_maintenance_targets_updated ON maintenance_targets(updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_jobs_active_dedupe
  ON maintenance_jobs(project_id, kind, dedupe_key)
  WHERE status IN ('pending', 'running', 'retry');
`;

interface SchemaMigration {
  id: string;
  apply: (db: any) => void;
}

function hasColumn(db: any, table: string, column: string): boolean {
  return db.prepare('PRAGMA table_info(' + table + ')')
    .all()
    .some((row: { name?: string }) => row.name === column);
}

function addColumnIfMissing(db: any, table: string, column: string, definition: string): void {
  if (hasColumn(db, table, column)) return;
  db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + definition);
}

const SCHEMA_MIGRATIONS: SchemaMigration[] = [
  {
    id: '1.2-code-state-snapshots',
    apply: (db) => {
      db.exec(CREATE_CODE_STATE_SNAPSHOTS_TABLE);
      addColumnIfMissing(db, 'code_files', 'snapshotId', 'snapshotId TEXT');
      addColumnIfMissing(db, 'code_files', 'sourceEpoch', 'sourceEpoch INTEGER');
      addColumnIfMissing(db, 'code_symbols', 'snapshotId', 'snapshotId TEXT');
      addColumnIfMissing(db, 'code_symbols', 'sourceEpoch', 'sourceEpoch INTEGER');
      addColumnIfMissing(db, 'code_edges', 'snapshotId', 'snapshotId TEXT');
      addColumnIfMissing(db, 'code_edges', 'sourceEpoch', 'sourceEpoch INTEGER');
      addColumnIfMissing(db, 'observation_code_refs', 'snapshotId', 'snapshotId TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_code_snapshots_project_epoch ON code_state_snapshots(projectId, sourceEpoch DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_code_files_snapshot ON code_files(projectId, snapshotId)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_code_symbols_snapshot ON code_symbols(projectId, snapshotId)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_code_edges_snapshot ON code_edges(projectId, snapshotId)');
    },
  },
  {
    id: '1.2-knowledge-claim-ledger',
    apply: (db) => {
      db.exec(CREATE_KNOWLEDGE_CLAIMS_TABLE);
      db.exec(CREATE_KNOWLEDGE_CLAIM_EVIDENCE_TABLE);
      db.exec(CREATE_KNOWLEDGE_CLAIM_EVENTS_TABLE);
      db.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_claims_project_status ON knowledge_claims(projectId, status, updatedAt DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_claims_project_conflict ON knowledge_claims(projectId, conflictKey, status)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_claims_project_key ON knowledge_claims(projectId, claimKey, status)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_claim_evidence_claim ON knowledge_claim_evidence(claimId, createdAt)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_claim_events_claim ON knowledge_claim_events(claimId, createdAt)');
    },
  },
];

function applySchemaMigrations(db: any): void {
  db.exec(CREATE_SCHEMA_MIGRATIONS_TABLE);
  for (const migration of SCHEMA_MIGRATIONS) {
    const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(migration.id);
    if (applied) continue;
    const apply = db.transaction(() => {
      migration.apply(db);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
        migration.id,
        new Date().toISOString(),
      );
    });
    apply();
  }
}

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

  loadBetterSqlite3();
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'memorix.db');
  const db = createDatabase(dbPath);

  // WAL mode for concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  // Create all tables
  db.exec(CREATE_OBSERVATIONS_TABLE);
  db.exec(CREATE_MINI_SKILLS_TABLE);
  db.exec(CREATE_SESSIONS_TABLE);
  db.exec(CREATE_META_TABLE);
  // Phase 4a: coordination tables (order matters for FK references)
  db.exec(CREATE_TEAM_AGENTS_TABLE);
  db.exec(CREATE_TEAM_TASKS_TABLE);
  db.exec(CREATE_TEAM_TASK_DEPS_TABLE);
  db.exec(CREATE_TEAM_MESSAGES_TABLE);
  db.exec(CREATE_TEAM_LOCKS_TABLE);
  db.exec(CREATE_TEAM_ROLES_TABLE);
  db.exec(CREATE_GRAPH_ENTITIES_TABLE);
  db.exec(CREATE_GRAPH_RELATIONS_TABLE);
  db.exec(CREATE_CHAT_TRANSCRIPT_TABLE);
  db.exec(CREATE_CODE_FILES_TABLE);
  db.exec(CREATE_CODE_SYMBOLS_TABLE);
  db.exec(CREATE_CODE_EDGES_TABLE);
  db.exec(CREATE_OBSERVATION_CODE_REFS_TABLE);
  db.exec(CREATE_MAINTENANCE_JOBS_TABLE);
  db.exec(CREATE_MAINTENANCE_TARGETS_TABLE);

  // Phase 3a migration: add sourceSnapshot + updatedAt to mini_skills
  // Idempotent — ALTER TABLE ADD COLUMN throws if column already exists
  // IMPORTANT: These must run BEFORE CREATE_INDEXES so columns exist when indexes reference them
  try { db.exec(`ALTER TABLE mini_skills ADD COLUMN sourceSnapshot TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE mini_skills ADD COLUMN updatedAt TEXT`); } catch { /* already exists */ }

  // Phase 4a: observation attribution columns
  try { db.exec(`ALTER TABLE observations ADD COLUMN createdByAgentId TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE observations ADD COLUMN writeGeneration INTEGER DEFAULT 0`); } catch { /* already exists */ }

  // Phase 4d: role-based coordination columns
  try { db.exec(`ALTER TABLE team_tasks ADD COLUMN required_role TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE team_tasks ADD COLUMN preferred_role TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE team_messages ADD COLUMN to_role TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE team_messages ADD COLUMN handoff_status TEXT`); } catch { /* already exists */ }

  // New migrations are transactional and tracked. Older idempotent migrations
  // remain untouched for backwards compatibility with existing local stores.
  applySchemaMigrations(db);

  // Create indexes AFTER all ALTER TABLE migrations so referenced columns exist
  db.exec(CREATE_INDEXES);

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
