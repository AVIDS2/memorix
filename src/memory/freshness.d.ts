/**
 * Unified Freshness Gate (Phase 3a)
 *
 * Replaces withFreshObservations() as the public API for all retrieval
 * surfaces. Checks both observation and mini-skill generation counters
 * to ensure the Orama index is fully up-to-date before any read.
 *
 * withFreshObservations() remains in observations.ts as @internal —
 * only called by this module and legacy test code.
 */
/**
 * Check if mini-skills have changed since our last index sync.
 * If stale, reindex all mini-skills in Orama.
 *
 * Returns true if the index was refreshed.
 */
export declare function ensureFreshMiniSkills(): Promise<boolean>;
/**
 * Reindex all mini-skills into the Orama database.
 * Uses deterministic doc ID tracking instead of empty-term search to ensure
 * all stale documents are removed reliably.
 */
export declare function reindexMiniSkills(): Promise<number>;
/**
 * Ensure both observations and mini-skills are fresh in the Orama index.
 * Returns true if any data source was refreshed.
 */
export declare function ensureFreshIndex(): Promise<boolean>;
/**
 * Centralized freshness gate — wraps a read-facing function with
 * ensureFreshIndex() so callers cannot forget the freshness check.
 *
 * Usage:
 *   return withFreshIndex(async () => { ... read from Orama ... });
 *
 * Phase 3a: replaces withFreshObservations() at all retrieval call sites.
 */
export declare function withFreshIndex<T>(fn: () => T | Promise<T>): Promise<T>;
/**
 * Reset mini-skill freshness tracking. Used in tests.
 */
export declare function resetMiniSkillFreshness(): void;
//# sourceMappingURL=freshness.d.ts.map