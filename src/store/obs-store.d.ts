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
    /** Load the ID counter (raw, no lock). */
    loadIdCounter(): Promise<number>;
    /** Save all observations (raw, no lock). */
    saveAll(obs: Observation[]): Promise<void>;
    /** Save the ID counter (raw, no lock). */
    saveIdCounter(nextId: number): Promise<void>;
}
export interface ObservationStore {
    /** One-time init: open DB/files, run migration if needed */
    init(dataDir: string): Promise<void>;
    /** Load all observations into memory. Called at startup after init(). */
    loadAll(): Promise<Observation[]>;
    /** Load the current next-ID counter value. */
    loadIdCounter(): Promise<number>;
    /** Insert a new observation. Bumps generation (if applicable). */
    insert(obs: Observation): Promise<void>;
    /** Update an existing observation in-place (matched by obs.id). */
    update(obs: Observation): Promise<void>;
    /** Remove a single observation by ID. */
    remove(id: number): Promise<void>;
    /**
     * Replace the entire observation set atomically.
     * Used by consolidation, cleanup, and project-ID migration.
     */
    bulkReplace(obs: Observation[]): Promise<void>;
    /** Remove multiple observations by ID in one operation. */
    bulkRemoveByIds(ids: number[]): Promise<void>;
    /** Persist the next-ID counter. */
    saveIdCounter(nextId: number): Promise<void>;
    /**
     * Execute fn while holding an exclusive lock (file lock for JSON,
     * transaction for SQLite). The StoreTransaction provides raw load/save
     * methods that operate within the lock scope.
     *
     * Used by storeObservation for compound topicKey-TOCTOU + ID-assignment.
     */
    atomic<T>(fn: (tx: StoreTransaction) => Promise<T>): Promise<T>;
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
    /** Close the backend (release DB handles, file locks, etc.). */
    close(): void;
    /** Which backend is active: 'sqlite' or 'degraded' (read-only). */
    getBackendName(): 'sqlite' | 'degraded';
}
/** Get the active ObservationStore singleton. Throws if not yet initialized. */
export declare function getObservationStore(): ObservationStore;
/** Set the active ObservationStore singleton (called once during startup). */
export declare function setObservationStore(store: ObservationStore): void;
/** Reset the singleton (for tests only). Detaches from the backend.
 *  Call closeAllDatabases() separately if you need to release the shared DB handle. */
export declare function resetObservationStore(): void;
/**
 * Create a fresh ObservationStore instance for a specific data directory
 * without touching the process-wide singleton. This is useful for long-lived
 * multi-project hosts (for example serve-http embedded dashboard APIs) where
 * requests may need to read different project data dirs concurrently.
 */
export declare function createObservationStore(dataDir: string): Promise<ObservationStore>;
/**
 * Initialize the ObservationStore singleton for the given data directory.
 *
 * Tries SQLite first. If unavailable, falls back to DegradedBackend (read-only).
 *
 * Idempotent: if already initialized for the same dataDir, returns the existing store.
 */
export declare function initObservationStore(dataDir: string): Promise<ObservationStore>;
/**
 * DegradedBackend — ObservationStore that is read-only and empty.
 *
 * Used when better-sqlite3 is unavailable. All write operations throw.
 * This ensures the system does not silently fall back to writing observations.json
 * as a runtime canonical store.
 */
export declare class DegradedBackend implements ObservationStore {
    private dataDir;
    init(dataDir: string): Promise<void>;
    loadAll(): Promise<Observation[]>;
    loadIdCounter(): Promise<number>;
    insert(_obs: Observation): Promise<void>;
    update(_obs: Observation): Promise<void>;
    remove(_id: number): Promise<void>;
    bulkReplace(_obs: Observation[]): Promise<void>;
    bulkRemoveByIds(_ids: number[]): Promise<void>;
    saveIdCounter(_nextId: number): Promise<void>;
    atomic<T>(_fn: (tx: StoreTransaction) => Promise<T>): Promise<T>;
    ensureFresh(): Promise<boolean>;
    getGeneration(): number;
    close(): void;
    getBackendName(): 'sqlite' | 'degraded';
}
//# sourceMappingURL=obs-store.d.ts.map