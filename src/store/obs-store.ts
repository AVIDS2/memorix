/**
 * ObservationStore — unified persistence abstraction for observations.
 *
 * Two backends:
 *   - JsonBackend  (json-store.ts)  — current file-lock + observations.json model
 *   - SqliteBackend (sqlite-store.ts) — WAL-mode SQLite with generation tracking
 *
 * All observation persistence flows through this interface.
 * Graph, sessions, mini-skills remain file-based (not in scope).
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
  /** Load the ID counter (raw, no lock). */
  loadIdCounter(): Promise<number>;
  /** Save all observations (raw, no lock). */
  saveAll(obs: Observation[]): Promise<void>;
  /** Save the ID counter (raw, no lock). */
  saveIdCounter(nextId: number): Promise<void>;
}

export interface ObservationStore {
  // ── Lifecycle ──────────────────────────────────────────────────────

  /** One-time init: open DB/files, run migration if needed */
  init(dataDir: string): Promise<void>;

  // ── Read ───────────────────────────────────────────────────────────

  /** Load all observations into memory. Called at startup after init(). */
  loadAll(): Promise<Observation[]>;

  /** Load the current next-ID counter value. */
  loadIdCounter(): Promise<number>;

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
   * Used by consolidation, cleanup, and project-ID migration.
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
   * - JsonBackend: no-op, returns false (every write already re-reads from disk)
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

  /** Which backend is active: 'sqlite' or 'json'. */
  getBackendName(): 'sqlite' | 'json';
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
 */
export async function createObservationStore(dataDir: string): Promise<ObservationStore> {
  // Try SQLite first (optionalDependencies — may not be installed)
  try {
    const { SqliteBackend } = await import('./sqlite-store.js');
    const store = new SqliteBackend();
    await store.init(dataDir);
    return store;
  } catch (err) {
    console.error(`[memorix] SQLite backend unavailable, falling back to JSON: ${err instanceof Error ? err.message : err}`);
  }

  // Fallback: JsonBackend (always works)
  const { JsonBackend } = await import('./json-store.js');
  const store = new JsonBackend();
  await store.init(dataDir);
  return store;
}

/**
 * Initialize the ObservationStore singleton for the given data directory.
 *
 * In Step A this always creates a JsonBackend.
 * In Step B this will try SQLite first, falling back to JSON.
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
