/**
 * Reciprocal Rank Fusion (RRF) — Multi-source result merging
 *
 * Merges ranked result lists from multiple search strategies
 * (full-text BM25, vector/semantic, graph traversal) into a single
 * re-ranked list using the RRF formula from:
 *   Cormack, Clarke & Buettcher (SIGIR 2009)
 *
 * Formula:  score(d) = Σ_i  weight_i / (k + rank_i(d))
 *
 * k=60 is the standard constant from the original paper.
 * Documents absent from a list contribute 0 for that list.
 * RRF ignores raw scores — only rank positions matter, which makes
 * it safe to fuse results from incomparable scoring systems (BM25,
 * cosine similarity, graph hop distance, etc.).
 */

import type { IndexEntry } from '../types.js';

// ─── Public Types ────────────────────────────────────────────────────────────

/** One ranked result list from a single search strategy */
export interface RrfSource {
  /** Ordered search results, best first */
  results: IndexEntry[];
  /**
   * Weight for this source.
   * Higher weight → stronger influence on the final ranking.
   * Default: 1. Typical values: 1 (equal), 0.5 (half weight), 2 (double weight).
   */
  weight?: number;
  /**
   * Optional label for trace output (e.g. 'bm25', 'vector', 'graph').
   * Not used in scoring — purely for debugging via buildRrfTrace().
   */
  label?: string;
}

/** Options for the RRF merger */
export interface RrfOptions {
  /**
   * Rank smoothing constant from Cormack et al. 2009.
   * k=60 is the paper's standard; higher k reduces the rank-position
   * advantage of top-ranked documents relative to lower-ranked ones.
   * Default: 60.
   */
  k?: number;
  /** Trim merged list to this many results. Omit or 0 for no limit. */
  limit?: number;
}

/** Per-document contribution from one source (for trace output) */
export interface RrfContribution {
  /** Source label (from RrfSource.label, or 'source-{index}' if unlabeled) */
  label: string;
  /** 1-based rank within this source, or null if the document was absent */
  rank: number | null;
  /** Weighted RRF contribution: weight / (k + rank), or 0 if absent */
  contribution: number;
}

/** Full debug trace for one merged result document */
export interface RrfTrace {
  /** Document identifier: `${projectId}::${observationId}` */
  key: string;
  /** Total accumulated RRF score across all sources */
  totalScore: number;
  /** Per-source contribution breakdown */
  contributions: RrfContribution[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Unique document key.
 * Mirrors orama-store's makeEntryKey: `${projectId}::${observationId}`.
 * projectId prevents cross-project collisions in global searches.
 */
function makeKey(entry: IndexEntry): string {
  return `${entry.projectId ?? ''}::${entry.id}`;
}

// ─── Core RRF ────────────────────────────────────────────────────────────────

/**
 * Merge multiple ranked result lists into a single re-ranked list
 * using Reciprocal Rank Fusion (RRF).
 *
 * Properties:
 * - Deduplicates by observationId + projectId
 * - Preserves IndexEntry data from the highest-ranked source on ties
 * - Sets `entry.score` to the computed RRF score (overwrites original)
 * - Documents appearing in more sources rank higher than single-source documents
 *
 * @param sources - One or more ranked result lists with optional per-source weights
 * @param options - k constant and optional result limit
 * @returns Merged, deduplicated, re-ranked IndexEntry[]
 */
export function mergeWithRRF(
  sources: RrfSource[],
  options: RrfOptions = {},
): IndexEntry[] {
  const k = options.k ?? 60;

  // Accumulated RRF scores per document key
  const scores = new Map<string, number>();
  // Best item: the IndexEntry from the list that ranked this document highest
  const bestItem = new Map<string, { entry: IndexEntry; bestRank: number }>();

  for (let listIdx = 0; listIdx < sources.length; listIdx++) {
    const source = sources[listIdx];
    const weight = source.weight ?? 1;

    for (let i = 0; i < source.results.length; i++) {
      const rank = i + 1; // 1-based
      const entry = source.results[i];
      const key = makeKey(entry);

      const contribution = weight / (k + rank);
      scores.set(key, (scores.get(key) ?? 0) + contribution);

      // Track item from the list that assigned it the highest rank (lowest number)
      const existing = bestItem.get(key);
      if (!existing || rank < existing.bestRank) {
        bestItem.set(key, { entry, bestRank: rank });
      }
    }
  }

  // Sort descending by RRF score; tiebreak by bestRank ascending (lower = better)
  let sorted = [...scores.entries()].sort((a, b) => {
    const scoreDiff = b[1] - a[1];
    if (scoreDiff !== 0) return scoreDiff;
    const rankA = bestItem.get(a[0])?.bestRank ?? Infinity;
    const rankB = bestItem.get(b[0])?.bestRank ?? Infinity;
    return rankA - rankB;
  });

  if (options.limit && options.limit > 0) {
    sorted = sorted.slice(0, options.limit);
  }

  const merged: IndexEntry[] = [];
  for (const [key, rrfScore] of sorted) {
    const item = bestItem.get(key);
    if (!item) continue;
    // Spread the best-ranked entry and overwrite score with RRF value
    merged.push({ ...item.entry, score: rrfScore });
  }
  return merged;
}

// ─── Debug Trace ─────────────────────────────────────────────────────────────

/**
 * Build a per-document breakdown showing how much each source contributed.
 *
 * Useful for:
 * - Debugging why a document ranked where it did
 * - Tuning per-source weights
 * - Auditing fusion quality
 *
 * @param sources - Same sources passed to mergeWithRRF
 * @param k - Same k constant used in mergeWithRRF (default 60)
 * @returns Array of RrfTrace, sorted by totalScore descending
 *
 * @example
 * const trace = buildRrfTrace([
 *   { results: bm25Results, label: 'bm25' },
 *   { results: vectorResults, label: 'vector', weight: 0.5 },
 * ]);
 * console.table(trace.map(t => ({ key: t.key, score: t.totalScore })));
 */
export function buildRrfTrace(sources: RrfSource[], k = 60): RrfTrace[] {
  // Build rank lookup per source: key → 1-based rank
  const rankMaps: Map<string, number>[] = sources.map((source) => {
    const m = new Map<string, number>();
    for (let i = 0; i < source.results.length; i++) {
      m.set(makeKey(source.results[i]), i + 1);
    }
    return m;
  });

  // Collect all unique document keys across all sources
  const allKeys = new Set<string>();
  for (const source of sources) {
    for (const entry of source.results) {
      allKeys.add(makeKey(entry));
    }
  }

  const traces: RrfTrace[] = [];

  for (const key of allKeys) {
    let totalScore = 0;
    const contributions: RrfContribution[] = [];

    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      const label = source.label ?? `source-${i}`;
      const weight = source.weight ?? 1;
      const rank = rankMaps[i].get(key) ?? null;
      const contribution = rank !== null ? weight / (k + rank) : 0;

      totalScore += contribution;
      contributions.push({ label, rank, contribution });
    }

    traces.push({ key, totalScore, contributions });
  }

  traces.sort((a, b) => b.totalScore - a.totalScore);
  return traces;
}
