/**
 * ObservationStore — unified persistence abstraction for observations.
 *
 * Backends:
 *   - SqliteBackend (sqlite-store.ts) — WAL-mode SQLite with generation tracking
 *   - DegradedBackend — read-only empty store when SQLite is unavailable
 *
 * JSON is no longer a runtime writable backend.
 * observations.json is only used as a one-time migration source into SQLite.
 *
 * All observation persistence flows through this interface.
 */

import type { Observation } from '../types.js';

/**
 * Raw transaction handle for compound atomic operations.
 *
 * Inside an `atomic()` block the caller gets a StoreTransaction whose methods
 * operate directly on the underlying storage WITHOUT acquiring their own lock.
 * The outer `atomic()` already holds the lock / transaction.
 */
export interface StoreTransaction {
  /** Load all observations (raw, no lock). */
  loadAll(): Promise<Observation[]>;
  /** Load one observation by its globally unique ID (raw, no lock). */
  getById(id: number): Promise<Observation | undefined>;
  /** Find one observation by its project-scoped topic key (raw, no lock). */
  findByTopicKey(projectId: string, topicKey: string): Promise<Observation | undefined>;
  /** Load the ID counter (raw, no lock). */
  loadIdCounter(): Promise<number>;
  /** Insert one observation without independently acquiring a lock. */
  insert(obs: Observation): Promise<void>;
  /** Update one observation without independently acquiring a lock. */
  update(obs: Observation): Promise<void>;
  /** Change only an observation's lifecycle status without replacing its other fields. */
  setStatus(id: number, status: string, expectedStatus?: string): Promise<boolean>;
  /** Remove one observation without independently acquiring a lock. */
  remove(id: number): Promise<void>;
  /** Save all observations (raw, no lock). */
  saveAll(obs: Observation[]): Promise<void>;
  /** Save the ID counter (raw, no lock). */
  saveIdCounter(nextId: number): Promise<void>;
  /** Read the storage generation visible to this transaction. */
  getGeneration(): Promise<number>;
}

export interface LexicalSearchOptions {
  query: string;
  projectId?: string | string[];
  status?: string | 'all';
  type?: string;
  source?: string;
  limit?: number;
}

export interface LexicalSearchHit {
  observation: Observation;
  score: number;
}

export interface ObservationStore {
  // ── Lifecycle ──────────────────────────────────────────────────────

  /** One-time init: open DB/files, run migration if needed */
  init(dataDir: string): Promise<void>;

  // ── Read ───────────────────────────────────────────────────────────

  /** Load all observations into memory. Called at startup after init(). */
  loadAll(): Promise<Observation[]>;

  /** Load one project's observations without scanning the shared flat store. */
  loadByProject(
    projectId: string,
    options?: { status?: string; limit?: number; offset?: number; afterId?: number; newestFirst?: boolean },
  ): Promise<Observation[]>;

  /** Count one project's observations without materializing the rows. */
  countByProject(projectId: string, options?: { status?: string; visibility?: 'project' }): Promise<number>;

  /** Load one observation by its globally unique ID. */
  getById(id: number): Promise<Observation | undefined>;

  /** Load the current next-ID counter value. */
  loadIdCounter(): Promise<number>;

  /** Count all durable observations without materializing their bodies. */
  countAll?(): Promise<number>;

  /** List project scopes without materializing observation bodies. */
  listProjectIds?(): Promise<string[]>;

  /**
   * Search the persistent lexical index without materializing the corpus.
   * Backends without FTS5 return an empty result and callers use the fallback.
   */
  searchLexical?(options: LexicalSearchOptions): Promise<LexicalSearchHit[]>;

  /** Whether a persistent lexical index is available for this backend. */
  hasLexicalIndex?(): boolean;

  /** Rebuild the derived lexical index from durable observations. */
  rebuildLexicalIndex?(): Promise<boolean>;

  // ── Write — single mutations ───────────────────────────────────────

  /** Insert a new observation. Bumps generation (if applicable). */
  insert(obs: Observation): Promise<void>;

  /** Update an existing observation in-place (matched by obs.id). */
  update(obs: Observation): Promise<void>;

  /** Remove a single observation by ID. */
  remove(id: number): Promise<void>;

  // ── Write — batch ──────────────────────────────────────────────────

  /**
   * Replace the entire observation set atomically.
   * Reserved for explicit full-state imports or recovery operations.
   */
  bulkReplace(obs: Observation[]): Promise<void>;

  /** Remove multiple observations by ID in one operation. */
  bulkRemoveByIds(ids: number[]): Promise<void>;

  /** Persist the next-ID counter. */
  saveIdCounter(nextId: number): Promise<void>;

  // ── Compound atomic operations ─────────────────────────────────────

  /**
   * Execute fn while holding an exclusive lock (file lock for JSON,
   * transaction for SQLite). The StoreTransaction provides raw load/save
   * methods that operate within the lock scope.
   *
   * Used by storeObservation for compound topicKey-TOCTOU + ID-assignment.
   */
  atomic<T>(fn: (tx: StoreTransaction) => Promise<T>): Promise<T>;

  // ── Freshness (cross-process coherence) ────────────────────────────

  /**
   * Check if another process has mutated the store since our last read.
   * If yes, the caller should reload observations[] and rebuild the Orama index.
   *
   * - SqliteBackend: compares storage_generation in meta table vs local knownGeneration
   * - DegradedBackend: no-op, returns false (no data to refresh)
   *
   * @returns true if the local cache is stale and was refreshed
   */
  ensureFresh(): Promise<boolean>;

  /** Current known generation counter (local). */
  getGeneration(): number;

  // ── Lifecycle ─────────────────────────────────────────────────────

  /** Close the backend (release DB handles, file locks, etc.). */
  close(): void;

  // ── Diagnostics ────────────────────────────────────────────────────

  /** Which backend is active: 'sqlite' or 'degraded' (read-only). */
  getBackendName(): 'sqlite' | 'degraded';
}

// ── Singleton store access ─────────────────────────────────────────

let _store: ObservationStore | null = null;
let _storeDataDir: string | null = null;

/** Get the active ObservationStore singleton. Throws if not yet initialized. */
export function getObservationStore(): ObservationStore {
  if (!_store) {
    throw new Error('[memorix] ObservationStore not initialized — call initObservationStore() first');
  }
  return _store;
}

/** Set the active ObservationStore singleton (called once during startup). */
export function setObservationStore(store: ObservationStore): void {
  _store = store;
}

/** Reset the singleton (for tests only). Detaches from the backend.
 *  Call closeAllDatabases() separately if you need to release the shared DB handle. */
export function resetObservationStore(): void {
  if (_store) {
    try { _store.close(); } catch { /* best-effort */ }
  }
  _store = null;
  _storeDataDir = null;
}

/** SQLite error codes that mean "busy right now", not "permanently broken". */
const TRANSIENT_SQLITE_ERROR = /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked/i;

function isTransientSqliteError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && TRANSIENT_SQLITE_ERROR.test(code)) return true;
  return err instanceof Error && TRANSIENT_SQLITE_ERROR.test(err.message);
}

const INIT_RETRY_DELAYS_MS = [50, 150, 400, 1000, 2500];

/**
 * Initialize a SQLite backend, retrying transient lock contention.
 *
 * Another process (for example the maintenance runner, or a second agent
 * harness) can hold a write transaction while we open the database and run
 * migrations. That is temporary by definition, so we back off and retry
 * instead of giving up on SQLite entirely.
 */
async function initSqliteWithRetry(store: ObservationStore, dataDir: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await store.init(dataDir);
      return;
    } catch (err) {
      if (!isTransientSqliteError(err) || attempt >= INIT_RETRY_DELAYS_MS.length) throw err;
      const delay = INIT_RETRY_DELAYS_MS[attempt];
      console.error(
        `[memorix] SQLite busy while opening store (attempt ${attempt + 1}/${INIT_RETRY_DELAYS_MS.length + 1}), retrying in ${delay}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Create a fresh ObservationStore instance for a specific data directory
 * without touching the process-wide singleton. This is useful for long-lived
 * multi-project hosts (for example serve-http embedded dashboard APIs) where
 * requests may need to read different project data dirs concurrently.
 *
 * Only a *structural* failure — better-sqlite3 genuinely unavailable — falls
 * back to the read-only DegradedBackend. A transient lock is retried, and a
 * persistent runtime failure is thrown rather than silently degraded: an
 * empty-looking store is far more dangerous than a loud error, because
 * callers cannot distinguish it from a project with no observations yet.
 */
export async function createObservationStore(dataDir: string): Promise<ObservationStore> {
  let SqliteBackend: new () => ObservationStore;
  try {
    ({ SqliteBackend } = await import('./sqlite-store.js'));
  } catch (err) {
    // Structural: the optional dependency is not installed. Degrading is correct.
    console.error(`[memorix] SQLite module unavailable — degraded mode (read-only): ${err instanceof Error ? err.message : err}`);
    const store = new DegradedBackend();
    await store.init(dataDir);
    return store;
  }

  // Runtime: the module loaded, so SQLite works. Lock contention is temporary.
  const store = new SqliteBackend();
  await initSqliteWithRetry(store, dataDir);
  return store;
}

/**
 * Initialize the ObservationStore singleton for the given data directory.
 *
 * Tries SQLite first. If unavailable, falls back to DegradedBackend (read-only).
 *
 * Idempotent: if already initialized for the same dataDir, returns the existing store.
 */
export async function initObservationStore(dataDir: string): Promise<ObservationStore> {
  if (_store && _storeDataDir === dataDir) {
    return _store;
  }

  // Close previous store if switching directories
  if (_store) {
    try { _store.close(); } catch { /* best-effort */ }
    _store = null;
    _storeDataDir = null;
  }

  const store = await createObservationStore(dataDir);
  _store = store;
  _storeDataDir = dataDir;
  return store;
}

// ── DegradedBackend (read-only when SQLite unavailable) ──────────

/**
 * DegradedBackend — ObservationStore that is read-only and empty.
 *
 * Used when better-sqlite3 is unavailable. All write operations throw.
 * This ensures the system does not silently fall back to writing observations.json
 * as a runtime canonical store.
 */
export class DegradedBackend implements ObservationStore {
  private dataDir: string = '';

  async init(dataDir: string): Promise<void> {
    this.dataDir = dataDir;
  }

  async loadAll(): Promise<Observation[]> {
    return [];
  }

  async loadByProject(_projectId: string, _options?: { status?: string; limit?: number; offset?: number; afterId?: number; newestFirst?: boolean }): Promise<Observation[]> {
    return [];
  }

  async countByProject(_projectId: string, _options?: { status?: string; visibility?: 'project' }): Promise<number> {
    return 0;
  }

  async getById(_id: number): Promise<Observation | undefined> {
    return undefined;
  }

  async loadIdCounter(): Promise<number> {
    return 1;
  }

  async countAll(): Promise<number> {
    return 0;
  }

  async listProjectIds(): Promise<string[]> {
    return [];
  }

  async searchLexical(_options: LexicalSearchOptions): Promise<LexicalSearchHit[]> {
    return [];
  }

  hasLexicalIndex(): boolean {
    return false;
  }

  async rebuildLexicalIndex(): Promise<boolean> {
    return false;
  }

  async insert(_obs: Observation): Promise<void> {
    throw new Error('[memorix] Cannot write observations: SQLite backend unavailable (degraded mode)');
  }

  async update(_obs: Observation): Promise<void> {
    throw new Error('[memorix] Cannot write observations: SQLite backend unavailable (degraded mode)');
  }

  async remove(_id: number): Promise<void> {
    throw new Error('[memorix] Cannot write observations: SQLite backend unavailable (degraded mode)');
  }

  async bulkReplace(_obs: Observation[]): Promise<void> {
    throw new Error('[memorix] Cannot write observations: SQLite backend unavailable (degraded mode)');
  }

  async bulkRemoveByIds(_ids: number[]): Promise<void> {
    throw new Error('[memorix] Cannot write observations: SQLite backend unavailable (degraded mode)');
  }

  async saveIdCounter(_nextId: number): Promise<void> {
    throw new Error('[memorix] Cannot write observations: SQLite backend unavailable (degraded mode)');
  }

  async atomic<T>(_fn: (tx: StoreTransaction) => Promise<T>): Promise<T> {
    throw new Error('[memorix] Cannot write observations: SQLite backend unavailable (degraded mode)');
  }

  async ensureFresh(): Promise<boolean> {
    return false;
  }

  getGeneration(): number {
    return 0;
  }

  close(): void {
    // No resources to release
  }

  getBackendName(): 'sqlite' | 'degraded' {
    return 'degraded';
  }
}
