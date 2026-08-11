import type {
  ContextCandidateFreshness,
  ContextCandidateKind,
  ContextCandidateTrust,
} from './context-assembly.js';

/**
 * A small, serializable description of an item competing for agent context.
 * This is intentionally independent from stores and prompt rendering so every
 * delivery surface can apply the same evidence rules.
 */
export interface GovernanceCandidate {
  kind: ContextCandidateKind;
  id?: string;
  estimatedTokens: number;
  relevance: number;
  scopeAllowed: boolean;
  freshness?: ContextCandidateFreshness;
  trust?: ContextCandidateTrust;
  quality?: 'verified' | 'probationary' | 'degraded' | 'blocked';
  conflict?: 'none' | 'possible' | 'confirmed';
  evidenceCount?: number;
}

export type GovernanceDisposition = 'include' | 'compact' | 'defer' | 'exclude';

export type GovernanceReason =
  | 'scope-forbidden'
  | 'confirmed-conflict'
  | 'blocked-quality'
  | 'degraded-quality'
  | 'stale-evidence'
  | 'unknown-freshness'
  | 'possible-conflict'
  | 'probationary-evidence'
  | 'token-budget'
  | 'current-source-backed-evidence'
  | 'relevant-evidence'
  | 'no-qualified-evidence';

export interface GovernanceDecision {
  candidate: GovernanceCandidate;
  disposition: GovernanceDisposition;
  reasons: GovernanceReason[];
}

export interface GovernancePlan {
  mode: 'abstain' | 'card' | 'workset';
  budget: { maxTokens: number; usedTokens: number };
  decisions: GovernanceDecision[];
  cautions: GovernanceReason[];
}

function clampRelevance(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function classify(candidate: GovernanceCandidate): Omit<GovernanceDecision, 'candidate'> {
  const freshness = candidate.freshness ?? 'unknown';
  const trust = candidate.trust ?? 'historical';
  const quality = candidate.quality ?? 'probationary';
  const conflict = candidate.conflict ?? 'none';

  if (!candidate.scopeAllowed) {
    return { disposition: 'exclude', reasons: ['scope-forbidden'] };
  }
  if (conflict === 'confirmed') {
    return { disposition: 'exclude', reasons: ['confirmed-conflict'] };
  }
  if (quality === 'blocked') {
    return { disposition: 'exclude', reasons: ['blocked-quality'] };
  }
  if (quality === 'degraded') {
    return { disposition: 'defer', reasons: ['degraded-quality'] };
  }
  if (freshness === 'stale') {
    return { disposition: 'defer', reasons: ['stale-evidence'] };
  }

  const reasons: GovernanceReason[] = [];
  let disposition: GovernanceDisposition = 'include';
  if (freshness === 'unknown') {
    disposition = 'compact';
    reasons.push('unknown-freshness');
  }
  if (conflict === 'possible') {
    disposition = 'compact';
    reasons.push('possible-conflict');
  }
  if (quality === 'probationary') {
    disposition = 'compact';
    reasons.push('probationary-evidence');
  }
  if (disposition === 'include' && freshness === 'current' && trust === 'source-backed') {
    reasons.push('current-source-backed-evidence');
  } else if (reasons.length === 0) {
    reasons.push('relevant-evidence');
  }
  return { disposition, reasons };
}

function priority(decision: GovernanceDecision): number {
  const dispositionWeight: Record<GovernanceDisposition, number> = {
    include: 3,
    compact: 2,
    defer: 1,
    exclude: 0,
  };
  const evidence = Math.min(3, decision.candidate.evidenceCount ?? 0) / 10;
  return dispositionWeight[decision.disposition] + clampRelevance(decision.candidate.relevance) + evidence;
}

/**
 * Decide which evidence may enter a bounded context response. The result never
 * mutates memory and deliberately prefers an explicit abstention to a generic
 * history dump.
 */
export function governContextCandidates(
  candidates: GovernanceCandidate[],
  maxTokens: number,
): GovernancePlan {
  const safeBudget = Math.max(0, Math.floor(maxTokens));
  const decisions = candidates.map(candidate => ({ candidate, ...classify(candidate) }));
  const eligible = decisions
    .filter(decision => decision.disposition === 'include' || decision.disposition === 'compact')
    .sort((left, right) => priority(right) - priority(left));
  let usedTokens = 0;

  for (const decision of eligible) {
    const tokens = Math.max(0, Math.ceil(decision.candidate.estimatedTokens));
    if (usedTokens + tokens <= safeBudget) {
      usedTokens += tokens;
      continue;
    }
    decision.disposition = 'defer';
    decision.reasons = [...decision.reasons, 'token-budget'];
  }

  const delivered = decisions.filter(decision => decision.disposition === 'include' || decision.disposition === 'compact');
  const mode = delivered.length === 0
    ? 'abstain'
    : delivered.some(decision => decision.disposition === 'include')
      ? 'workset'
      : 'card';
  const cautions = [...new Set(decisions
    .filter(decision => decision.disposition !== 'include')
    .flatMap(decision => decision.reasons))];

  return {
    mode,
    budget: { maxTokens: safeBudget, usedTokens },
    decisions,
    cautions: cautions.length > 0 ? cautions : ['no-qualified-evidence'],
  };
}
