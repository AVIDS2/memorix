import type { Observation } from '../types.js';

export interface SyncEligibility {
  eligible: boolean;
  reason?: string;
}

/**
 * The first sync contract is deliberately conservative. A remote relay is not
 * an agent-facing visibility boundary, so only durable project memory crosses
 * it. Personal, team, candidate, and ephemeral records stay local.
 */
export function syncEligibility(observation: Observation, projectId: string): SyncEligibility {
  if (observation.projectId !== projectId) return { eligible: false, reason: 'other-project' };
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

export function eligibleObservations(observations: Observation[], projectId: string): {
  eligible: Observation[];
  excluded: number;
} {
  const eligible: Observation[] = [];
  let excluded = 0;
  for (const observation of observations) {
    if (syncEligibility(observation, projectId).eligible) eligible.push(observation);
    else excluded++;
  }
  return { eligible, excluded };
}
