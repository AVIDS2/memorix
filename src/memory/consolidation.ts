/**
 * Memory Consolidation Engine
 *
 * Merges similar observations into consolidated summaries to prevent data bloat.
 * Uses text similarity (Jaccard on token n-grams) to find clusters of related
 * observations, then merges them into a single observation preserving key facts.
 *
 * Strategy:
 * 1. Group observations by entity + type
 * 2. Within each group, compute pairwise similarity
 * 3. Cluster observations above a similarity threshold
 * 4. Merge each cluster into a consolidated observation
 * 5. Remove originals, keep the merged result
 *
 * Inspired by Engram's duplicate_count and MemCP's MAGMA consolidation.
 */

import type { Observation } from '../types.js';
import { getObservationStore } from '../store/obs-store.js';

/** Default similarity threshold for merging (0.0-1.0) */
const DEFAULT_SIMILARITY_THRESHOLD = 0.45;

/** Higher threshold for high-value types — only near-duplicates should merge */
const HIGH_VALUE_SIMILARITY_THRESHOLD = 0.85;

/** Types that require much higher similarity to merge (carry unique implementation detail) */
const HIGH_VALUE_TYPES = new Set(['gotcha', 'decision', 'trade-off', 'reasoning', 'problem-solution']);

/** Minimum cluster size to trigger consolidation */
const MIN_CLUSTER_SIZE = 2;

/** Maximum observations to process in one consolidation run */
const MAX_BATCH_SIZE = 500;

/**
 * Tokenize text into word-level tokens for similarity comparison.
 */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1),
  );
}

/**
 * Compute Jaccard similarity between two sets of tokens.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Build a text fingerprint from an observation for similarity matching.
 */
function observationFingerprint(obs: Observation): string {
  return [obs.title, obs.narrative, ...obs.facts, ...obs.concepts].join(' ');
}

/** A cluster of similar observations to be merged */
export interface ConsolidationCluster {
  /** IDs of observations in this cluster */
  ids: number[];
  /** Titles of observations in this cluster */
  titles: string[];
  /** Average pairwise similarity */
  similarity: number;
  /** The entity these belong to */
  entityName: string;
  /** The observation type */
  type: string;
}

/** Result of a consolidation run */
export interface ConsolidationResult {
  /** Number of clusters found */
  clustersFound: number;
  /** Number of observations merged */
  observationsMerged: number;
  /** Number of observations after consolidation */
  observationsAfter: number;
  /** Details of each merge */
  merges: Array<{
    clusterId: number;
    mergedIds: number[];
    resultTitle: string;
    factCount: number;
  }>;
}

/**
 * Find clusters of similar observations that could be consolidated.
 * Does NOT modify data — use this for preview / dry run.
 */
export async function findConsolidationCandidates(
  projectDir: string,
  projectId: string,
  opts?: { threshold?: number; limit?: number },
): Promise<ConsolidationCluster[]> {
  const threshold = opts?.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const limit = opts?.limit ?? MAX_BATCH_SIZE;

  const store = getObservationStore();
  const allObs = await store.loadAll();
  const projectObs = allObs
    .filter(o => o.projectId === projectId)
    .slice(0, limit);

  if (projectObs.length < MIN_CLUSTER_SIZE) return [];

  // Group by entity + type
  const groups = new Map<string, Observation[]>();
  for (const obs of projectObs) {
    const key = `${obs.entityName}::${obs.type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(obs);
  }

  const clusters: ConsolidationCluster[] = [];

  for (const [, group] of groups) {
    if (group.length < MIN_CLUSTER_SIZE) continue;

    // High-value types require much higher similarity to merge
    const groupType = group[0].type;
    const effectiveThreshold = HIGH_VALUE_TYPES.has(groupType)
      ? Math.max(threshold, HIGH_VALUE_SIMILARITY_THRESHOLD)
      : threshold;

    // Pre-compute fingerprints
    const fingerprints = group.map(obs => ({
      obs,
      tokens: tokenize(observationFingerprint(obs)),
    }));

    // Track which observations are already clustered
    const clustered = new Set<number>();

    // Greedy clustering: for each unclustered obs, find similar ones
    for (let i = 0; i < fingerprints.length; i++) {
      if (clustered.has(fingerprints[i].obs.id)) continue;

      const cluster: Observation[] = [fingerprints[i].obs];
      let totalSim = 0;
      let simCount = 0;

      for (let j = i + 1; j < fingerprints.length; j++) {
        if (clustered.has(fingerprints[j].obs.id)) continue;

        const sim = jaccardSimilarity(fingerprints[i].tokens, fingerprints[j].tokens);
        if (sim >= effectiveThreshold) {
          cluster.push(fingerprints[j].obs);
          totalSim += sim;
          simCount++;
        }
      }

      if (cluster.length >= MIN_CLUSTER_SIZE) {
        for (const obs of cluster) clustered.add(obs.id);
        clusters.push({
          ids: cluster.map(o => o.id),
          titles: cluster.map(o => o.title),
          similarity: simCount > 0 ? totalSim / simCount : 0,
          entityName: cluster[0].entityName,
          type: cluster[0].type,
        });
      }
    }
  }

  return clusters;
}

/**
 * Execute consolidation — merge clusters into single observations.
 *
 * For each cluster:
 * 1. Keep the most recent observation as the "primary"
 * 2. Merge facts, files, concepts from all members (deduplicated)
 * 3. Create a consolidated narrative
 * 4. Remove the other members
 */
export async function executeConsolidation(
  projectDir: string,
  projectId: string,
  opts?: { threshold?: number; limit?: number },
): Promise<ConsolidationResult> {
  const clusters = await findConsolidationCandidates(projectDir, projectId, opts);

  const store = getObservationStore();

  if (clusters.length === 0) {
    const allObs = await store.loadAll();
    return {
      clustersFound: 0,
      observationsMerged: 0,
      observationsAfter: allObs.filter(o => o.projectId === projectId).length,
      merges: [],
    };
  }

  const result: ConsolidationResult = {
    clustersFound: clusters.length,
    observationsMerged: 0,
    observationsAfter: 0,
    merges: [],
  };

  await store.atomic(async (tx) => {
    const allObs = await tx.loadAll();
    const obsMap = new Map(allObs.map(o => [o.id, o]));
    const idsToRemove = new Set<number>();

    for (let ci = 0; ci < clusters.length; ci++) {
      const cluster = clusters[ci];
      const members = cluster.ids
        .map(id => obsMap.get(id))
        .filter((o): o is Observation => o !== undefined);

      if (members.length < MIN_CLUSTER_SIZE) continue;

      // Sort by date — most recent first
      members.sort((a, b) =>
        new Date(b.updatedAt || b.createdAt).getTime() -
        new Date(a.updatedAt || a.createdAt).getTime(),
      );

      const primary = members[0];
      const others = members.slice(1);

      // Merge facts (deduplicated)
      const allFacts = new Set(primary.facts);
      for (const other of others) {
        for (const fact of other.facts) allFacts.add(fact);
      }

      // Merge files (deduplicated, case-insensitive)
      const fileSet = new Set(primary.filesModified.map(f => f.toLowerCase()));
      const allFiles = [...primary.filesModified];
      for (const other of others) {
        for (const f of other.filesModified) {
          if (!fileSet.has(f.toLowerCase())) {
            fileSet.add(f.toLowerCase());
            allFiles.push(f);
          }
        }
      }

      // Merge concepts (deduplicated)
      const conceptSet = new Set(primary.concepts);
      for (const other of others) {
        for (const c of other.concepts) conceptSet.add(c);
      }

      // Build consolidated narrative
      const narrativeParts = [primary.narrative];
      for (const other of others) {
        if (other.narrative !== primary.narrative) {
          narrativeParts.push(`[Consolidated from #${other.id}] ${other.narrative}`);
        }
      }

      // Update primary
      primary.facts = [...allFacts];
      primary.filesModified = allFiles;
      primary.concepts = [...conceptSet];
      primary.narrative = narrativeParts.join('\n\n');
      primary.updatedAt = new Date().toISOString();
      primary.revisionCount = (primary.revisionCount ?? 1) + others.length;

      // Mark others for removal
      for (const other of others) {
        idsToRemove.add(other.id);
      }

      result.observationsMerged += others.length;
      result.merges.push({
        clusterId: ci,
        mergedIds: cluster.ids,
        resultTitle: primary.title,
        factCount: primary.facts.length,
      });
    }

    // Remove merged observations
    const remaining = allObs.filter(o => !idsToRemove.has(o.id));
    await tx.saveAll(remaining);

    result.observationsAfter = remaining.filter(o => o.projectId === projectId).length;
  });

  return result;
}
