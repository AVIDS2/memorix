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
 *
 * Uses the shared database handle from sqlite-db.ts so that observations,
 * mini-skills, and sessions all share one connection and one DB file.
 */
import type { Observation } from '../types.js';
import type { ObservationStore, StoreTransaction } from './obs-store.js';
export declare class SqliteBackend implements ObservationStore {
    private db;
    private dataDir;
    private knownGeneration;
    private _atomicQueue;
    private stmtInsert;
    private stmtUpdate;
    private stmtDelete;
    private stmtSelectAll;
    private stmtSelectGeneration;
    private stmtBumpGeneration;
    private stmtGetMeta;
    private stmtSetMeta;
    init(dataDir: string): Promise<void>;
    private readGeneration;
    private bumpGeneration;
    private rawLoadAll;
    private rawLoadIdCounter;
    private rawSaveIdCounter;
    private migrateFromJsonIfNeeded;
    loadAll(): Promise<Observation[]>;
    loadIdCounter(): Promise<number>;
    insert(obs: Observation): Promise<void>;
    update(obs: Observation): Promise<void>;
    remove(id: number): Promise<void>;
    bulkReplace(obs: Observation[]): Promise<void>;
    bulkRemoveByIds(ids: number[]): Promise<void>;
    saveIdCounter(nextId: number): Promise<void>;
    atomic<T>(fn: (tx: StoreTransaction) => Promise<T>): Promise<T>;
    ensureFresh(): Promise<boolean>;
    getGeneration(): number;
    close(): void;
    getBackendName(): 'sqlite' | 'degraded';
}
//# sourceMappingURL=sqlite-store.d.ts.map