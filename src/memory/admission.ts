import type { Observation, ObservationAdmissionState, ObservationType } from '../types.js';

const DURABLE_AUTOMATIC_TYPES = new Set<ObservationType>([
  'decision',
  'gotcha',
  'problem-solution',
  'trade-off',
  'why-it-exists',
]);

/**
 * Legacy observations predate admission metadata and retain their existing
 * delivery behavior. New automatic captures must explicitly earn delivery.
 */
export function isEligibleForAutomaticDelivery(observation: Pick<Observation, 'admissionState'>): boolean {
  return observation.admissionState !== 'ephemeral' && observation.admissionState !== 'candidate';
}

export function isCandidateObservation(observation: Pick<Observation, 'admissionState'>): boolean {
  return observation.admissionState === 'candidate';
}

export function isEligibleForKnowledgePromotion(
  observation: Pick<Observation, 'admissionState' | 'valueCategory'>,
): boolean {
  return isEligibleForAutomaticDelivery(observation) && observation.valueCategory !== 'ephemeral';
}

export interface CandidateQualification {
  admissionState: ObservationAdmissionState;
  admissionReason: string;
}

/**
 * Automatic hook records can become default-deliverable only after a current
 * Code Memory link backs a non-ephemeral candidate. This deliberately does
 * not create a claim: claims keep their explicit/Git source boundary.
 */
export function qualifyCandidateFromCurrentCode(input: {
  observation: Pick<Observation, 'admissionState' | 'valueCategory' | 'type'>;
  currentCodeReferenceCount: number;
}): CandidateQualification | undefined {
  if (!isCandidateObservation(input.observation)) return undefined;
  if (input.observation.valueCategory === 'ephemeral') return undefined;
  if (input.currentCodeReferenceCount <= 0) return undefined;

  const typeLabel = DURABLE_AUTOMATIC_TYPES.has(input.observation.type)
    ? 'high-value automatic record'
    : 'automatic record';
  return {
    admissionState: 'qualified',
    admissionReason: `${typeLabel} qualified against ${input.currentCodeReferenceCount} current Code Memory reference(s)`,
  };
}
