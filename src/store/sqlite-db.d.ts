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
export declare function loadBetterSqlite3(): any;
/**
 * Get or create a shared better-sqlite3 database handle for the given data directory.
 *
 * The handle is cached per normalized dataDir path. All stores (observations,
 * mini-skills, sessions) share the same connection and the same DB file.
 *
 * Callers must NOT close the returned handle directly — use closeDatabase().
 */
export declare function getDatabase(dataDir: string): any;
/**
 * Close and remove a cached database handle for the given data directory.
 * Safe to call even if no handle exists.
 */
export declare function closeDatabase(dataDir: string): void;
/**
 * Close all cached database handles. Used during shutdown or tests.
 */
export declare function closeAllDatabases(): void;
/**
 * Check if better-sqlite3 is available without throwing.
 */
export declare function isSqliteAvailable(): boolean;
//# sourceMappingURL=sqlite-db.d.ts.map