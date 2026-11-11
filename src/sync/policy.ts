import type { Observation } from '../types.js';

export type SyncScope = 'project' | 'user';

export interface SyncEligibility {
  eligible: boolean;
  reason?: string;
}

/**
 * The first sync contract is deliberately conservative. A remote relay is not
 * an agent-facing visibility boundary, so only durable project memory crosses
 * it. Personal, team, candidate, and ephemeral records stay local.
 *
 * `--scope project` (default) also drops other-project rows. `--scope user`
 * keeps those rows so one local SQLite can replicate every project.
 */
export function syncEligibility(
  observation: Observation,
  scopeId: string,
  scope: SyncScope = 'project',
): SyncEligibility {
  if (scope === 'project' && observation.projectId !== scopeId) {
    return { eligible: false, reason: 'other-project' };
  }
  if ((observation.visibility ?? 'project') !== 'project') return { eligible: false, reason: 'non-project-visibility' };
  if ((observation.sharedWithAgentIds?.length ?? 0) > 0) {
    return { eligible: false, reason: 'agent-targeted' };
  }
  if (observation.admissionState === 'candidate' || observation.admissionState === 'ephemeral') {
    return { eligible: false, reason: 'unqualified-observation' };
  }
  if (observation.valueCategory === 'ephemeral') return { eligible: false, reason: 'ephemeral-value' };
  return { eligible: true };
}

export function eligibleObservations(
  observations: Observation[],
  scopeId: string,
  scope: SyncScope = 'project',
): {
  eligible: Observation[];
  excluded: number;
} {
  const eligible: Observation[] = [];
  let excluded = 0;
  for (const observation of observations) {
    if (syncEligibility(observation, scopeId, scope).eligible) eligible.push(observation);
    else excluded++;
  }
  return { eligible, excluded };
}
