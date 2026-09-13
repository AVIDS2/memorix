/**
 * ObservationStore — unified persistence abstraction for observations.
 *
 * Backends:
 *   - SqliteBackend (sqlite-store.ts) — WAL-mode SQLite with generation tracking
 *   - DegradedBackend — diagnostic-only backend when SQLite is unavailable
 *
 * JSON is no longer a runtime writable backend.
 * observations.json is only used as a one-time migration source into SQLite.
 *
 * All observation persistence flows through this interface.
 */

import type { Observation } from '../types.js';
import { degradedReadError, degradedWriteError, formatSqliteFailure, isSqliteUnavailableError, initializeSqliteStore } from './sqlite-reliability.js';

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

  /** Why a degraded backend was selected, when applicable. */
  getBackendReason?(): string | undefined;
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
  try {
    const { SqliteBackend } = await import('./sqlite-store.js');
    return await initializeSqliteStore(() => new SqliteBackend(), dataDir, 'Observation store');
  } catch (err) {
    if (!isSqliteUnavailableError(err)) throw err;
    const reason = formatSqliteFailure(err);
    console.error(`[memorix] SQLite module unavailable — degraded mode (reads/writes disabled): ${reason}`);
    const degraded = new DegradedBackend(reason);
    await degraded.init(dataDir);
    return degraded;
  }
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

// ── DegradedBackend (diagnostic-only when SQLite unavailable) ─────

/**
 * DegradedBackend — diagnostic-only backend used when SQLite is unavailable.
 *
 * Business reads and writes throw instead of returning synthetic empty data.
 * This ensures the system does not silently fall back to writing observations.json
 * as a runtime canonical store.
 */
export class DegradedBackend implements ObservationStore {
  private dataDir: string = '';

  constructor(private readonly reason = 'SQLite runtime unavailable') {}

  private unavailableRead(): Error {
    return degradedReadError('observations');
  }

  async init(dataDir: string): Promise<void> {
    this.dataDir = dataDir;
  }

  async loadAll(): Promise<Observation[]> {
    throw this.unavailableRead();
  }

  async loadByProject(_projectId: string, _options?: { status?: string; limit?: number; offset?: number; afterId?: number; newestFirst?: boolean }): Promise<Observation[]> {
    throw this.unavailableRead();
  }

  async countByProject(_projectId: string, _options?: { status?: string; visibility?: 'project' }): Promise<number> {
    throw this.unavailableRead();
  }

  async getById(_id: number): Promise<Observation | undefined> {
    throw this.unavailableRead();
  }

  async loadIdCounter(): Promise<number> {
    throw this.unavailableRead();
  }

  async countAll(): Promise<number> {
    throw this.unavailableRead();
  }

  async listProjectIds(): Promise<string[]> {
    throw this.unavailableRead();
  }

  async searchLexical(_options: LexicalSearchOptions): Promise<LexicalSearchHit[]> {
    throw this.unavailableRead();
  }

  hasLexicalIndex(): boolean {
    return false;
  }

  async rebuildLexicalIndex(): Promise<boolean> {
    return false;
  }

  async insert(_obs: Observation): Promise<void> {
    throw degradedWriteError('observations');
  }

  async update(_obs: Observation): Promise<void> {
    throw degradedWriteError('observations');
  }

  async remove(_id: number): Promise<void> {
    throw degradedWriteError('observations');
  }

  async bulkReplace(_obs: Observation[]): Promise<void> {
    throw degradedWriteError('observations');
  }

  async bulkRemoveByIds(_ids: number[]): Promise<void> {
    throw degradedWriteError('observations');
  }

  async saveIdCounter(_nextId: number): Promise<void> {
    throw degradedWriteError('observations');
  }

  async atomic<T>(_fn: (tx: StoreTransaction) => Promise<T>): Promise<T> {
    throw degradedWriteError('observations');
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

  getBackendReason(): string {
    return this.reason;
  }
}
