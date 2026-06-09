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
// ── Singleton store access ─────────────────────────────────────────
let _store = null;
let _storeDataDir = null;
/** Get the active ObservationStore singleton. Throws if not yet initialized. */
export function getObservationStore() {
    if (!_store) {
        throw new Error('[memorix] ObservationStore not initialized — call initObservationStore() first');
    }
    return _store;
}
/** Set the active ObservationStore singleton (called once during startup). */
export function setObservationStore(store) {
    _store = store;
}
/** Reset the singleton (for tests only). Detaches from the backend.
 *  Call closeAllDatabases() separately if you need to release the shared DB handle. */
export function resetObservationStore() {
    if (_store) {
        try {
            _store.close();
        }
        catch { /* best-effort */ }
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
export async function createObservationStore(dataDir) {
    // Try SQLite first (optionalDependencies — may not be installed)
    try {
        const { SqliteBackend } = await import('./sqlite-store.js');
        const store = new SqliteBackend();
        await store.init(dataDir);
        return store;
    }
    catch (err) {
        console.error(`[memorix] SQLite backend unavailable — degraded mode (read-only): ${err instanceof Error ? err.message : err}`);
    }
    // No writable JSON fallback — degraded read-only mode instead
    // observations.json is only used as migration source, not runtime backend
    const store = new DegradedBackend();
    await store.init(dataDir);
    return store;
}
/**
 * Initialize the ObservationStore singleton for the given data directory.
 *
 * Tries SQLite first. If unavailable, falls back to DegradedBackend (read-only).
 *
 * Idempotent: if already initialized for the same dataDir, returns the existing store.
 */
export async function initObservationStore(dataDir) {
    if (_store && _storeDataDir === dataDir) {
        return _store;
    }
    // Close previous store if switching directories
    if (_store) {
        try {
            _store.close();
        }
        catch { /* best-effort */ }
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
export class DegradedBackend {
    dataDir = '';
    async init(dataDir) {
        this.dataDir = dataDir;
    }
    async loadAll() {
        return [];
    }
    async loadIdCounter() {
        return 1;
    }
    async insert(_obs) {
        throw new Error('[memorix] Cannot write observations: SQLite backend unavailable (degraded mode)');
    }
    async update(_obs) {
        throw new Error('[memorix] Cannot write observations: SQLite backend unavailable (degraded mode)');
    }
    async remove(_id) {
        throw new Error('[memorix] Cannot write observations: SQLite backend unavailable (degraded mode)');
    }
    async bulkReplace(_obs) {
        throw new Error('[memorix] Cannot write observations: SQLite backend unavailable (degraded mode)');
    }
    async bulkRemoveByIds(_ids) {
        throw new Error('[memorix] Cannot write observations: SQLite backend unavailable (degraded mode)');
    }
    async saveIdCounter(_nextId) {
        throw new Error('[memorix] Cannot write observations: SQLite backend unavailable (degraded mode)');
    }
    async atomic(_fn) {
        throw new Error('[memorix] Cannot write observations: SQLite backend unavailable (degraded mode)');
    }
    async ensureFresh() {
        return false;
    }
    getGeneration() {
        return 0;
    }
    close() {
        // No resources to release
    }
    getBackendName() {
        return 'degraded';
    }
}
//# sourceMappingURL=obs-store.js.map