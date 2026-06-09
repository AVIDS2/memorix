/**
 * Index Formatter
 *
 * Formats search, timeline, and detail outputs for the compact engine.
 */
import type { IndexEntry, TimelineContext } from '../types.js';
/**
 * Format a list of IndexEntries as a compact markdown table.
 */
export declare function formatIndexTable(entries: IndexEntry[], query?: string, forceProjectColumn?: boolean): string;
/**
 * Format a timeline context around an anchor observation.
 * When any entry carries sourceDetail provenance, adds a Src column and
 * annotates the anchor with its evidence kind. Falls back to the original
 * table format when no provenance is present (backward-compat).
 */
export declare function formatTimeline(timeline: TimelineContext): string;
/**
 * Format full observation details (Layer 3).
 * When sourceDetail/valueCategory are present, prepends a provenance header
 * that clearly identifies the evidence kind before the main #ID block.
 * Backward-compatible: if neither field is set, output is identical to before.
 */
export declare function formatObservationDetail(doc: {
    observationId: number;
    type: string;
    title: string;
    narrative: string;
    facts: string;
    filesModified: string;
    concepts: string;
    createdAt: string;
    projectId: string;
    entityName: string;
    sourceDetail?: string;
    valueCategory?: string;
    source?: string;
    commitHash?: string;
    relatedCommits?: string[];
}): string;
//# sourceMappingURL=index-format.d.ts.map