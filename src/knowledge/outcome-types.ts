/**
 * Append-only evidence about whether a context artifact helped or was
 * contradicted. Signals never replace the artifact they describe.
 */
export const MEMORY_OUTCOME_CANDIDATE_KINDS = ['claim', 'durable-memory', 'workflow'] as const;
export type MemoryOutcomeCandidateKind = typeof MEMORY_OUTCOME_CANDIDATE_KINDS[number];

export const MEMORY_OUTCOME_SIGNAL_KINDS = [
  'verification-passed',
  'verification-failed',
  'verified-reuse',
  'user-pin',
  'user-correction',
  'source-changed',
  'conflict-confirmed',
  'manual-review',
] as const;
export type MemoryOutcomeSignalKind = typeof MEMORY_OUTCOME_SIGNAL_KINDS[number];

export interface MemoryOutcomeSignal {
  id: string;
  projectId: string;
  candidateKind: MemoryOutcomeCandidateKind;
  candidateId: string;
  kind: MemoryOutcomeSignalKind;
  sourceRef: string;
  snapshotId?: string;
  detail?: string;
  observedAt: string;
}

export type OutcomeQuality = 'verified' | 'probationary' | 'degraded';

/** The newest auditable signal wins; missing signals leave lifecycle state in charge. */
export function qualityFromOutcome(signal?: Pick<MemoryOutcomeSignal, 'kind'>): OutcomeQuality | undefined {
  if (!signal) return undefined;
  if (signal.kind === 'verification-failed'
    || signal.kind === 'user-correction'
    || signal.kind === 'source-changed'
    || signal.kind === 'conflict-confirmed') {
    return 'degraded';
  }
  if (signal.kind === 'verification-passed'
    || signal.kind === 'verified-reuse'
    || signal.kind === 'user-pin') {
    return 'verified';
  }
  return undefined;
}
