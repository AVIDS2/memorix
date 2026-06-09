/**
 * Observations Manager
 *
 * Manages rich observation records with auto-classification and token counting.
 * Source: claude-mem's observation data model with structured fields.
 *
 * Each observation is stored both in the knowledge graph (as entity observation)
 * and in the Orama search index (for full-text + vector search).
 */
import type { Observation, ObservationType, ObservationStatus, ProgressInfo } from '../types.js';
/**
 * Initialize the observations manager with a project directory.
 * Auto-initializes the ObservationStore if not already set.
 */
export declare function initObservations(dir: string): Promise<void>;
/**
 * Check cross-process freshness and reload if another process has written.
 *
 * Call this at every read boundary (MCP tool handler, dashboard API, etc.)
 * BEFORE reading observations[] via getObservation / getAllObservations /
 * getProjectObservations / getObservationCount.
 *
 * When the SQLite storage_generation has advanced beyond our local snapshot:
 *   1. Reloads observations[] from the store
 *   2. Updates nextId from the store
 *   3. Rebuilds the Orama search index (so vector + BM25 search stay in sync)
 *
 * For DegradedBackend this is a no-op (always returns false).
 */
export declare function ensureFreshObservations(): Promise<boolean>;
/**
 * @internal Observation-only freshness gate.
 *
 * Public callers should use `withFreshIndex()` from freshness.ts instead,
 * which also covers mini-skills. This function remains for internal use
 * by the freshness module and legacy test code only.
 */
export declare function withFreshObservations<T>(fn: () => T | Promise<T>): Promise<T>;
/**
 * Store a new observation.
 *
 * This is the primary write API — called by the `memorix_store` MCP tool.
 * Automatically:
 *   1. Assigns an incremental ID
 *   2. Counts tokens for the observation content
 *   3. Inserts into Orama for full-text search
 *   4. Persists to disk
 */
export declare function storeObservation(input: {
    entityName: string;
    type: ObservationType;
    title: string;
    narrative: string;
    facts?: string[];
    filesModified?: string[];
    concepts?: string[];
    projectId: string;
    topicKey?: string;
    sessionId?: string;
    progress?: ProgressInfo;
    source?: 'agent' | 'git' | 'manual';
    commitHash?: string;
    relatedCommits?: string[];
    relatedEntities?: string[];
    sourceDetail?: 'explicit' | 'hook' | 'git-ingest';
    valueCategory?: 'core' | 'contextual' | 'ephemeral';
    createdByAgentId?: string;
}): Promise<{
    observation: Observation;
    upserted: boolean;
}>;
/**
 * Get an observation by ID.
 */
export declare function getObservation(id: number, projectId?: string): Observation | undefined;
/**
 * Resolve observations — mark them as resolved (completed/no longer active).
 * This prevents resolved memories from appearing in default search results.
 */
export declare function resolveObservations(ids: number[], status?: ObservationStatus): Promise<{
    resolved: number[];
    notFound: number[];
}>;
/**
 * Get all observations for a project.
 * Supports alias expansion: if projectIds is an array, matches any of them.
 */
export declare function getProjectObservations(projectId: string | string[]): Observation[];
/**
 * Migrate observations from non-canonical project IDs to the canonical ID.
 *
 * Called once during server startup after alias registration.
 * Rewrites in-memory observations and persists changes to disk.
 *
 * @param aliasIds - All known alias IDs for this project (including canonical)
 * @param canonicalId - The canonical project ID to normalize to
 * @returns Number of observations migrated
 */
export declare function migrateProjectIds(aliasIds: string[], canonicalId: string): Promise<number>;
/**
 * Get all observations (in-memory copy).
 * Used by timeline and retention to avoid unreliable Orama empty-term queries.
 */
export declare function getAllObservations(): Observation[];
/**
 * Get the total number of stored observations.
 */
export declare function getObservationCount(): number;
/**
 * Suggest a stable topic key from type + title.
 * Uses family heuristics (architecture/*, bug/*, decision/*, etc.)
 * Inspired by Engram's mem_suggest_topic_key.
 */
export declare function suggestTopicKey(type: string, title: string): string;
/**
 * Reload observations into the Orama index with full corpus embeddings.
 * Intended for explicit heavy rebuilds, not normal MCP startup.
 *
 * Optimization: uses batch embedding (ONNX processes 64 texts at a time)
 * instead of individual embed calls. This reduces startup CPU from minutes
 * to seconds for large observation sets (500+).
 */
export declare function reindexObservations(): Promise<number>;
/**
 * Prepare the search index for startup and hot-reload without blocking on
 * corpus-wide embedding generation.
 *
 * This hydrates the lexical/BM25 index immediately so MCP availability is not
 * coupled to embedding provider throughput. Missing vectors are queued for the
 * existing background backfill cycle.
 */
export declare function prepareSearchIndex(): Promise<number>;
/**
 * Get the current set of observation IDs that are missing vector embeddings.
 * Useful for dashboards, health checks, and monitoring search quality degradation.
 */
export declare function getVectorMissingIds(): number[];
/**
 * Get a summary of vector embedding status.
 * Returns total observations, how many have vectors, and how many are missing.
 */
export declare function getVectorStatus(): {
    total: number;
    missing: number;
    missingIds: number[];
    backfillRunning: boolean;
};
/**
 * Attempt to backfill missing vector embeddings.
 * Re-generates embeddings for observations in vectorMissingIds.
 * Returns the number successfully backfilled.
 *
 * Safe to call concurrently — only one backfill runs at a time.
 */
export declare function backfillVectorEmbeddings(): Promise<{
    attempted: number;
    succeeded: number;
    failed: number;
}>;
//# sourceMappingURL=observations.d.ts.map