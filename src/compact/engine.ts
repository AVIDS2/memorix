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

import type { SearchOptions, IndexEntry, TimelineContext, MemorixDocument } from '../types.js';
import { searchObservations, getTimeline } from '../store/orama-store.js';
import { getObservation } from '../memory/observations.js';
import { formatIndexTable, formatTimeline, formatObservationDetail } from './index-format.js';
import { countTextTokens } from './token-budget.js';

/**
 * Layer 1: Search and return a compact index.
 * Agent scans this to decide which observations to fetch in detail.
 */
export async function compactSearch(options: SearchOptions): Promise<{
  entries: IndexEntry[];
  formatted: string;
  totalTokens: number;
}> {
  const entries = await searchObservations(options);
  const formatted = formatIndexTable(entries, options.query);
  const totalTokens = countTextTokens(formatted);

  return { entries, formatted, totalTokens };
}

/**
 * Layer 2: Get timeline context around an anchor observation.
 * Shows what happened before and after for temporal understanding.
 */
export async function compactTimeline(
  anchorId: number,
  projectId?: string,
  depthBefore = 3,
  depthAfter = 3,
): Promise<{
  timeline: TimelineContext;
  formatted: string;
  totalTokens: number;
}> {
  const result = await getTimeline(anchorId, projectId, depthBefore, depthAfter);

  const timeline: TimelineContext = {
    anchorId,
    anchorEntry: result.anchor,
    before: result.before,
    after: result.after,
  };

  const formatted = formatTimeline(timeline);
  const totalTokens = countTextTokens(formatted);

  return { timeline, formatted, totalTokens };
}

/**
 * Layer 3: Get full observation details by IDs.
 * Only called after the agent has filtered via L1/L2.
 */
export async function compactDetail(
  ids: number[],
): Promise<{
  documents: MemorixDocument[];
  formatted: string;
  totalTokens: number;
}> {
  // Use in-memory observations for reliable ID lookup (Orama where-clause
  // can be unreliable with empty term + number filter)
  const documents: MemorixDocument[] = [];
  for (const id of ids) {
    const obs = getObservation(id);
    if (obs) {
      documents.push({
        id: `obs-${obs.id}`,
        observationId: obs.id,
        entityName: obs.entityName,
        type: obs.type,
        title: obs.title,
        narrative: obs.narrative,
        facts: obs.facts.join('\n'),
        filesModified: obs.filesModified.join('\n'),
        concepts: obs.concepts.join(', '),
        tokens: obs.tokens,
        createdAt: obs.createdAt,
        projectId: obs.projectId,
        accessCount: 0,
        lastAccessedAt: '',
      });
    }
  }

  const formattedParts = documents.map((doc: MemorixDocument) =>
    formatObservationDetail(doc),
  );

  const formatted = formattedParts.join('\n\n' + '═'.repeat(50) + '\n\n');
  const totalTokens = countTextTokens(formatted);

  return { documents, formatted, totalTokens };
}
