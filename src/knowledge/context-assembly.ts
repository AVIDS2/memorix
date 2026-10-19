/**
 * Shared metadata contract for every bounded context delivery surface.
 * The rendered Workset stays agent-facing; this receipt is for JSON, explain,
 * diagnostics, and future handoff adapters.
 */
export type ContextDeliveryTarget =
  | 'project-context'
  | 'context-pack'
  | 'hook-session-start'
  | 'hook-user-prompt'
  | 'session-handoff';

export type ContextCandidateKind =
  | 'task'
  | 'continuity'
  | 'continuation'
  | 'current-fact'
  | 'code-state'
  | 'semantic-code'
  | 'graph-evidence'
  | 'start-here'
  | 'memory'
  | 'durable-memory'
  | 'claim'
  | 'knowledge-page'
  | 'workflow'
  | 'verification'
  | 'caution';

export type ContextCandidateFreshness = 'current' | 'suspect' | 'stale' | 'unknown';
export type ContextCandidateTrust = 'source-backed' | 'derived' | 'historical';
export type ContextCandidateQuality = 'verified' | 'probationary' | 'degraded' | 'blocked';
export type ContextCandidateConflict = 'none' | 'possible' | 'confirmed';
export type ContextRetrievalMode = 'lexical' | 'semantic' | 'hybrid' | 'fallback' | 'unknown';

export interface ContextReceiptRetrieval {
  mode: ContextRetrievalMode;
  codeProvider?: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  candidateCount: number;
  selectedCount: number;
  omittedCount: number;
}

export interface ContextReceiptSelection {
  kind: ContextCandidateKind;
  /** Stable source id when the candidate has one; never raw content. */
  id?: string;
  reason: string;
  freshness?: ContextCandidateFreshness;
  trust?: ContextCandidateTrust;
}

export interface ContextReceiptOmission {
  kind: ContextCandidateKind;
  reason: 'token-budget' | 'hidden-by-task-lens' | 'unavailable';
  count: number;
  /** Bounded stable references for omitted evidence; never raw content. */
  sampleIds?: string[];
}

export interface ContextReceiptGovernanceDecision {
  kind: ContextCandidateKind;
  id?: string;
  disposition: 'include' | 'compact' | 'defer' | 'exclude';
  reasons: string[];
  freshness?: ContextCandidateFreshness;
  trust?: ContextCandidateTrust;
  quality?: ContextCandidateQuality;
  conflict?: ContextCandidateConflict;
  evidenceCount?: number;
}

/** Privacy-safe evidence qualification, never appended to the agent prompt. */
export interface ContextReceiptGovernance {
  /** Current implementation qualifies optional memory/knowledge, not caller task facts. */
  scope: 'optional-evidence';
  mode: 'abstain' | 'card' | 'workset';
  decisions: ContextReceiptGovernanceDecision[];
  cautions: string[];
}

export interface ContextReceipt {
  version: '1.3';
  target: ContextDeliveryTarget;
  elapsedMs: number;
  budget: {
    maxTokens: number;
    tokenCount: number;
  };
  retrieval: ContextReceiptRetrieval;
  selected: ContextReceiptSelection[];
  omitted: ContextReceiptOmission[];
  governance?: ContextReceiptGovernance;
  scheduledActions: string[];
}

function displayTarget(target: ContextDeliveryTarget): string {
  switch (target) {
    case 'project-context': return 'Project Context';
    case 'context-pack': return 'Context Pack';
    case 'hook-session-start': return 'SessionStart hook';
    case 'hook-user-prompt': return 'UserPromptSubmit hook';
    case 'session-handoff': return 'session handoff';
  }
}

/** A human-facing diagnostic formatter. Do not append this to agent context. */
export function formatContextReceipt(receipt: ContextReceipt): string {
  const lines = [
    'Context delivery receipt',
    `- Target: ${displayTarget(receipt.target)}`,
    `- Budget: ${receipt.budget.tokenCount}/${receipt.budget.maxTokens} tokens`,
    `- Assembly: ${receipt.elapsedMs} ms`,
    `- Selected: ${receipt.selected.length} item(s)`,
    `- Retrieval: ${receipt.retrieval.mode} (${receipt.retrieval.candidateCount} optional candidate(s))`,
  ];

  if (receipt.retrieval.fallbackUsed) {
    lines.push(`- Fallback: ${receipt.retrieval.fallbackReason ?? 'retrieval fallback used'}`);
  }

  if (receipt.selected.length > 0) {
    lines.push('', 'Selected evidence');
    for (const item of receipt.selected.slice(0, 20)) {
      const id = item.id ? ` ${item.id}` : '';
      const qualifiers = [item.trust, item.freshness].filter(Boolean).join(', ');
      lines.push(`- ${item.kind}${id}: ${item.reason}${qualifiers ? ` (${qualifiers})` : ''}`);
    }
  }

  if (receipt.omitted.length > 0) {
    lines.push('', 'Withheld by budget');
    for (const item of receipt.omitted) {
      const samples = item.sampleIds?.length ? ` [${item.sampleIds.join(', ')}]` : '';
      lines.push(`- ${item.kind}: ${item.count} item(s) (${item.reason})${samples}`);
    }
  }

  if (receipt.governance?.decisions.length) {
    lines.push('', 'Optional evidence qualification');
    for (const item of receipt.governance.decisions.slice(0, 20)) {
      const id = item.id ? ` ${item.id}` : '';
      const qualifiers = [item.quality, item.freshness, item.trust, item.conflict]
        .filter(Boolean)
        .join(', ');
      const evidence = item.evidenceCount === undefined ? '' : `, evidence=${item.evidenceCount}`;
      lines.push(`- ${item.kind}${id}: ${item.disposition} (${item.reasons.join(', ')}${qualifiers ? `; ${qualifiers}${evidence}` : evidence})`);
    }
  }

  if (receipt.scheduledActions.length > 0) {
    lines.push('', 'Scheduled follow-up');
    for (const action of receipt.scheduledActions) lines.push(`- ${action}`);
  }

  return lines.join('\n');
}
