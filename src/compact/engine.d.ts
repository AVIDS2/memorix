/**
 * Compact Engine
 *
 * Orchestrates the 3-layer Progressive Disclosure workflow.
 * Source: claude-mem's proven architecture (27K stars, ~10x token savings).
 *
 * Layer 1 (search)   → Compact index with IDs (~50-100 tokens/result)
 * Layer 2 (timeline) → Chronological context around an observation
 * Layer 3 (detail)   → Full observation content (~500-1000 tokens/result)
 */
import type { SearchOptions, IndexEntry, TimelineContext, MemorixDocument, ObservationRef } from '../types.js';
/**
 * Layer 1: Search and return a compact index.
 * Agent scans this to decide which observations to fetch in detail.
 */
export declare function compactSearch(options: SearchOptions): Promise<{
    entries: IndexEntry[];
    formatted: string;
    totalTokens: number;
}>;
/**
 * Layer 2: Get timeline context around an anchor observation.
 * Shows what happened before and after for temporal understanding.
 */
export declare function compactTimeline(anchorId: number, projectId?: string, depthBefore?: number, depthAfter?: number): Promise<{
    timeline: TimelineContext;
    formatted: string;
    totalTokens: number;
}>;
/**
 * Layer 3: Get full observation or mini-skill details by IDs or typed refs.
 * Only called after the agent has filtered via L1/L2.
 *
 * Phase 3a: Accepts typed MemoryRef inputs (obs:42, skill:3) alongside
 * legacy bare numbers and ObservationRef objects.
 */
export declare function compactDetail(idsOrRefs: number[] | ObservationRef[] | string[]): Promise<{
    documents: MemorixDocument[];
    formatted: string;
    totalTokens: number;
}>;
//# sourceMappingURL=engine.d.ts.map