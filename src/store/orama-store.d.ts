/**
 * Orama Store
 *
 * Full-text + vector + hybrid search engine backed by Orama.
 * Source: @orama/orama (10.1K stars, <2KB, pure JS, zero deps)
 *
 * Schema designed to store Observations with all searchable fields.
 * Vector search (embeddings) will be added in P1 phase.
 */
import { type AnyOrama } from '@orama/orama';
import type { MemorixDocument, SearchOptions, IndexEntry } from '../types.js';
export declare function getLastSearchMode(projectId?: string): string;
/**
 * Build a globally unique Orama document ID for an observation.
 * observationId is only unique within a project, so projectId must be included.
 */
export declare function makeOramaObservationId(projectId: string, observationId: number): string;
/** @internal Exported for testing only. */
export { classifyQueryTier as _classifyQueryTier };
/**
 * Query tier classification for performance-aware search.
 * - 'fast':     short/exact/command queries → fulltext only, no embedding, no rerank
 * - 'standard': normal queries → fulltext + embedding, no rerank
 * - 'heavy':    CJK or long ambiguous queries → expansion + embedding + rerank
 */
type QueryTier = 'fast' | 'standard' | 'heavy';
declare function classifyQueryTier(query: string): QueryTier;
/**
 * Initialize or return the Orama database instance.
 * Schema conditionally includes vector field based on embedding provider.
 * Graceful degradation: no provider → fulltext only, provider → hybrid.
 */
export declare function getDb(): Promise<AnyOrama>;
/**
 * Reset the database instance (useful for testing).
 */
export declare function resetDb(): Promise<void>;
/**
 * Check if embedding/vector search is active.
 */
export declare function isEmbeddingEnabled(): boolean;
/**
 * Current vector dimensions for the active Orama index.
 * Returns null when vector search is disabled for this process.
 */
export declare function getVectorDimensions(): number | null;
/**
 * Generate embedding for text content using the available provider.
 * Returns null if no provider is available.
 */
export declare function generateEmbedding(text: string): Promise<number[] | null>;
/**
 * Batch-generate embeddings for multiple texts.
 * Much faster than individual calls — ONNX processes batches of 64 in parallel.
 * Returns null entries for texts that fail.
 */
export declare function batchGenerateEmbeddings(texts: string[]): Promise<(number[] | null)[]>;
/**
 * Hydrate the Orama index from persisted observations.
 * Must be called before searching if the index was freshly created (TUI / CLI startup).
 * Skips observations already in the index (idempotent).
 */
export declare function hydrateIndex(observations: any[]): Promise<number>;
/**
 * Insert an observation document into the store.
 */
export declare function insertObservation(doc: MemorixDocument): Promise<void>;
/**
 * Remove an observation document by its Orama internal ID.
 */
export declare function removeObservation(oramaId: string): Promise<void>;
/**
 * Search observations using Orama full-text search.
 * Returns L1 IndexEntry array (compact, ~50-100 tokens per result).
 *
 * Progressive Disclosure Layer 1 — adopted from claude-mem.
 */
export declare function searchObservations(options: SearchOptions): Promise<IndexEntry[]>;
/**
 * Get full observation documents by their observation IDs.
 *
 * Progressive Disclosure Layer 3 — adopted from claude-mem.
 */
export declare function getObservationsByIds(ids: number[], projectId?: string): Promise<MemorixDocument[]>;
/**
 * Get observations around an anchor for timeline context.
 *
 * Progressive Disclosure Layer 2 — adopted from claude-mem.
 */
export declare function getTimeline(anchorId: number, projectId?: string, depthBefore?: number, depthAfter?: number): Promise<{
    before: IndexEntry[];
    anchor: IndexEntry | null;
    after: IndexEntry[];
}>;
/**
 * Get total observation count, optionally filtered by project.
 */
export declare function getObservationCount(projectId?: string): Promise<number>;
//# sourceMappingURL=orama-store.d.ts.map