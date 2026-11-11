import type { Observation } from '../types.js';
import type { ObservationStore } from '../store/obs-store.js';

const LOW_QUALITY_PATTERNS = [
  /^Session activity/i,
  /^Updated \S+\.\w+$/i,
  /^Created \S+\.\w+$/i,
  /^Deleted \S+\.\w+$/i,
  /^Modified \S+\.\w+$/i,
  /^Ran command:/i,
  /^Read file:/i,
];

const EXPLICIT_NOISE_TITLE_PATTERNS = [
  /^\s*\[(?:test|demo|benchmark|sandbox|playground|测试|演示)\]/i,
  /^\s*(?:Used\s+(?:mcp__\S+|apply_patch)|Ran:)\s*/i,
];

const EXPLICIT_NOISE_MARKERS = new Set([
  'test-fixture',
  'demo-fixture',
  'benchmark-fixture',
  'sandbox-fixture',
  'cleanup-noise',
]);

export interface CleanupNoiseHit {
  observation: Observation;
  reason: 'system-self' | 'demo/test/noise';
}

export interface CleanupDuplicateGroup {
  canonical: Observation;
  duplicates: Observation[];
}

export interface CleanupAnalysis {
  totalActive: number;
  highQuality: number;
  lowQuality: Observation[];
  duplicateGroups: CleanupDuplicateGroup[];
  duplicates: Observation[];
  noise: CleanupNoiseHit[];
  toRemove: Observation[];
  toArchive: Observation[];
}

export function isLowQualityObservation(title: string): boolean {
  return LOW_QUALITY_PATTERNS.some((pattern) => pattern.test(title.trim()));
}

export function classifyNoiseObservation(
  observation: Pick<Observation, 'title' | 'narrative' | 'entityName' | 'facts' | 'concepts'>,
): { isNoise: boolean; reason?: CleanupNoiseHit['reason'] } {
  const title = observation.title?.trim() ?? '';
  const entityName = observation.entityName?.trim().toLowerCase() ?? '';
  const concepts = (observation.concepts ?? []).map((concept) => concept.trim().toLowerCase());

  if (
    entityName === 'memorix.demo'
    || entityName.startsWith('for_memmcp_test')
    || concepts.some((concept) => EXPLICIT_NOISE_MARKERS.has(concept))
  ) {
    return { isNoise: true, reason: 'system-self' };
  }
  if (EXPLICIT_NOISE_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return { isNoise: true, reason: 'demo/test/noise' };
  }
  return { isNoise: false };
}

export function analyzeCleanupObservations(
  observations: readonly Observation[],
  options: { includeNoise?: boolean } = {},
): CleanupAnalysis {
  const active = observations.filter((observation) => (observation.status ?? 'active') === 'active');
  const lowQuality = active.filter((observation) => isLowQualityObservation(observation.title ?? ''));
  const lowQualityIds = new Set(lowQuality.map((observation) => observation.id));
  const highQuality = active.filter((observation) => !lowQualityIds.has(observation.id));

  const groups = new Map<string, CleanupDuplicateGroup>();
  for (const observation of highQuality) {
    const key = `${observation.type}|${observation.title}|${observation.entityName}`;
    const existing = groups.get(key);
    if (existing) existing.duplicates.push(observation);
    else groups.set(key, { canonical: observation, duplicates: [] });
  }
  const duplicateGroups = [...groups.values()].filter((group) => group.duplicates.length > 0);
  const duplicates = duplicateGroups.flatMap((group) => group.duplicates);
  const excludedIds = new Set([...lowQuality, ...duplicates].map((observation) => observation.id));

  const noise: CleanupNoiseHit[] = [];
  if (options.includeNoise) {
    for (const observation of active) {
      if (excludedIds.has(observation.id)) continue;
      const classification = classifyNoiseObservation(observation);
      if (classification.isNoise && classification.reason) {
        noise.push({ observation, reason: classification.reason });
      }
    }
  }

  const toRemove = [...lowQuality, ...duplicates];
  const toArchive = noise.map((hit) => hit.observation);
  return {
    totalActive: active.length,
    highQuality: highQuality.length - duplicates.length - toArchive.length,
    lowQuality,
    duplicateGroups,
    duplicates,
    noise,
    toRemove,
    toArchive,
  };
}

function requireObservationIds(observations: readonly Observation[], action: string): number[] {
  const ids = observations.map((observation) => observation.id);
  if (ids.some((id) => typeof id !== 'number')) {
    throw new Error(`Cannot ${action}: an observation has no persisted ID.`);
  }
  return ids as number[];
}

export async function applyCleanupMutations(
  store: ObservationStore,
  toArchive: readonly Observation[],
  toRemove: readonly Observation[],
): Promise<{ archived: number; removed: number }> {
  const archiveIds = requireObservationIds(toArchive, 'archive');
  const removeIds = requireObservationIds(toRemove, 'delete');
  const removals = new Set(removeIds);
  if (archiveIds.some((id) => removals.has(id))) {
    throw new Error('Cleanup cannot archive and delete the same observation.');
  }

  await store.atomic(async (tx) => {
    await Promise.all(archiveIds.map((id) => tx.setStatus(id, 'archived', 'active')));
    await Promise.all(removeIds.map((id) => tx.remove(id)));
  });

  return { archived: archiveIds.length, removed: removeIds.length };
}
