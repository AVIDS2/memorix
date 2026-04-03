/**
 * Attribution Guard
 *
 * Detects when a write's entityName is better known in a different project than
 * the currently bound session project.  Used to:
 *
 *   1. Emit a passive warning on memorix_store / memorix_store_reasoning when a
 *      suspicious attribution is detected (Goal A — prevent new wrong-bucket writes).
 *   2. Scan an existing project for already-misattributed observations so an
 *      operator can archive/move them (Goal B — legacy cleanup audit).
 *
 * Both functions are alias-aware: projectIds are normalised to their canonical
 * form via the alias registry before any comparison, so the same physical repo
 * seen under multiple aliases is never mis-counted as two separate projects.
 *
 * Detection heuristic (low false-positive):
 *   suspicious = entityName appears 0× in currentProject AND ≥ threshold× in
 *                exactly one other canonical project.
 */

import type { Observation } from '../types.js';
import { getCanonicalId, resolveAliases } from '../project/aliases.js';

/** Default minimum occurrence count in another project to trigger suspicion. */
const DEFAULT_THRESHOLD = 2;

// ── Shared helpers ─────────────────────────────────────────────────────────

/**
 * Resolve every unique projectId found in the observation list to its canonical
 * form.  Returns a Map<rawProjectId, canonicalId>.
 * Best-effort: if alias registry is unavailable for a given ID, falls back to
 * the raw projectId so the guard degrades gracefully.
 */
async function buildCanonicalMap(
  obs: Observation[],
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(obs.map((o) => o.projectId).filter(Boolean))];
  const map = new Map<string, string>();
  await Promise.all(
    uniqueIds.map(async (pid) => {
      try {
        map.set(pid, await getCanonicalId(pid));
      } catch {
        map.set(pid, pid);
      }
    }),
  );
  return map;
}

/**
 * Build a two-level count map:
 *   canonical projectId → entityName → occurrence count
 * Only active observations are counted.
 */
function buildEntityCountMap(
  obs: Observation[],
  canonicalMap: Map<string, string>,
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  for (const o of obs) {
    if ((o.status ?? 'active') !== 'active') continue;
    if (!o.entityName) continue;
    const canonical = canonicalMap.get(o.projectId) ?? o.projectId;
    if (!result.has(canonical)) result.set(canonical, new Map());
    const inner = result.get(canonical)!;
    inner.set(o.entityName, (inner.get(o.entityName) ?? 0) + 1);
  }
  return result;
}

// ── Goal A: write-time passive check ──────────────────────────────────────

export interface AttributionResult {
  /** True when the entity is unseen in the current project but well-known in another. */
  suspicious: boolean;
  /** Canonical projectId where the entity actually lives (present when suspicious). */
  knownIn?: string;
  /** How many times the entity appears in knownIn (present when suspicious). */
  count?: number;
  /** 'high' when count ≥ 5, otherwise 'low'. */
  confidence?: 'high' | 'low';
  /** Human-readable explanation (present when suspicious). */
  reason?: string;
}

/**
 * Check whether entityName is anomalous for the current session's project.
 *
 * Alias-aware: both currentProjectId and the projectIds stored in observations
 * are resolved to canonical IDs before comparison.
 *
 * @param entityName       The entity being written.
 * @param currentProjectId The session's bound project (may be a raw/alias ID).
 * @param allObservations  Snapshot from getAllObservations() (passed in to avoid
 *                         circular imports and to allow easy unit testing).
 * @param threshold        Minimum occurrences in another project to flag (default 2).
 */
export async function checkProjectAttribution(
  entityName: string,
  currentProjectId: string,
  allObservations: Observation[],
  threshold = DEFAULT_THRESHOLD,
): Promise<AttributionResult> {
  let currentCanonical: string;
  try {
    currentCanonical = await getCanonicalId(currentProjectId);
  } catch {
    currentCanonical = currentProjectId;
  }

  const canonicalMap = await buildCanonicalMap(allObservations);
  const entityCounts = buildEntityCountMap(allObservations, canonicalMap);

  const currentCount =
    entityCounts.get(currentCanonical)?.get(entityName) ?? 0;

  if (currentCount > 0) {
    return { suspicious: false };
  }

  // Find the other canonical project with the highest count for this entity
  let maxCount = 0;
  let maxCanonical = '';
  for (const [canonical, inner] of entityCounts) {
    if (canonical === currentCanonical) continue;
    const count = inner.get(entityName) ?? 0;
    if (count > maxCount) {
      maxCount = count;
      maxCanonical = canonical;
    }
  }

  if (maxCount < threshold) {
    return { suspicious: false };
  }

  return {
    suspicious: true,
    knownIn: maxCanonical,
    count: maxCount,
    confidence: maxCount >= 5 ? 'high' : 'low',
    reason:
      `Entity "${entityName}" has 0 observations in "${currentCanonical}" ` +
      `but ${maxCount} in "${maxCanonical}"`,
  };
}

// ── Goal B: legacy audit scan ─────────────────────────────────────────────

export interface AuditEntry {
  /** Observation ID. */
  id: number;
  /** Raw projectId stored on the observation (may differ from canonical). */
  projectId: string;
  entityName: string;
  title: string;
  /** Memory source: 'agent' | 'git' | 'manual'. */
  source: string;
  /** Provenance detail: 'explicit' | 'hook' | 'git-ingest' | undefined. */
  sourceDetail: string | undefined;
  /** Canonical projectId where this entity is better known. */
  likelyBelongsTo: string;
  /** Occurrence count of entityName in likelyBelongsTo. */
  count: number;
  confidence: 'high' | 'low';
}

/**
 * Scan all active observations belonging to currentProjectId (including aliases)
 * and return those whose entityName is suspicious — i.e., not seen elsewhere in
 * the same project but well-known in a different canonical project.
 *
 * @param currentProjectId  The session's bound project (may be raw/alias ID).
 * @param allObservations   Full observation list from getAllObservations().
 * @param threshold         Minimum occurrences in another project to flag (default 2).
 */
export async function auditProjectObservations(
  currentProjectId: string,
  allObservations: Observation[],
  threshold = DEFAULT_THRESHOLD,
): Promise<AuditEntry[]> {
  // Resolve current project aliases — we scan obs stored under ANY alias
  let currentAliases: string[];
  let currentCanonical: string;
  try {
    currentAliases = await resolveAliases(currentProjectId);
    currentCanonical = await getCanonicalId(currentProjectId);
  } catch {
    currentAliases = [currentProjectId];
    currentCanonical = currentProjectId;
  }
  const aliasSet = new Set(currentAliases);

  const activeObs = allObservations.filter(
    (o) => (o.status ?? 'active') === 'active',
  );

  // Build global canonical map and entity count map once
  const canonicalMap = await buildCanonicalMap(activeObs);
  const entityCounts = buildEntityCountMap(activeObs, canonicalMap);

  // Observations belonging to the current project (any alias)
  const projectObs = activeObs.filter((o) => aliasSet.has(o.projectId));

  const entries: AuditEntry[] = [];

  for (const obs of projectObs) {
    if (!obs.entityName) continue;

    const currentCount =
      entityCounts.get(currentCanonical)?.get(obs.entityName) ?? 0;

    if (currentCount > 1) continue; // entity is meaningfully present → skip

    // Find best alternative canonical project
    let maxCount = 0;
    let maxCanonical = '';
    for (const [canonical, inner] of entityCounts) {
      if (canonical === currentCanonical) continue;
      const count = inner.get(obs.entityName) ?? 0;
      if (count > maxCount) {
        maxCount = count;
        maxCanonical = canonical;
      }
    }

    if (maxCount < threshold) continue;

    entries.push({
      id: obs.id,
      projectId: obs.projectId,
      entityName: obs.entityName,
      title: obs.title,
      source: obs.source ?? 'agent',
      sourceDetail: obs.sourceDetail,
      likelyBelongsTo: maxCanonical,
      count: maxCount,
      confidence: maxCount >= 5 ? 'high' : 'low',
    });
  }

  return entries;
}
