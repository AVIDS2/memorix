/**
 * Shared metadata contract for every bounded context delivery surface.
 * The rendered Workset stays agent-facing; this receipt is for JSON, explain,
 * diagnostics, and future handoff adapters.
 */
export type ContextDeliveryTarget =
  | 'project-context'
  | 'context-pack'
  | 'hook-session-start'
  | 'session-handoff';

export type ContextCandidateKind =
  | 'task'
  | 'current-fact'
  | 'code-state'
  | 'semantic-code'
  | 'start-here'
  | 'memory'
  | 'claim'
  | 'knowledge-page'
  | 'workflow'
  | 'verification'
  | 'caution';

export type ContextCandidateFreshness = 'current' | 'suspect' | 'stale' | 'unknown';
export type ContextCandidateTrust = 'source-backed' | 'derived' | 'historical';

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
}

export interface ContextReceipt {
  version: '1.2.2';
  target: ContextDeliveryTarget;
  elapsedMs: number;
  budget: {
    maxTokens: number;
    tokenCount: number;
  };
  selected: ContextReceiptSelection[];
  omitted: ContextReceiptOmission[];
  scheduledActions: string[];
}

function displayTarget(target: ContextDeliveryTarget): string {
  switch (target) {
    case 'project-context': return 'Project Context';
    case 'context-pack': return 'Context Pack';
    case 'hook-session-start': return 'SessionStart hook';
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
  ];

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
      lines.push(`- ${item.kind}: ${item.count} item(s) (${item.reason})`);
    }
  }

  if (receipt.scheduledActions.length > 0) {
    lines.push('', 'Scheduled follow-up');
    for (const action of receipt.scheduledActions) lines.push(`- ${action}`);
  }

  return lines.join('\n');
}
