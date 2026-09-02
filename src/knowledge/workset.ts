import { countTextTokens, truncateToTokenBudget } from '../compact/token-budget.js';
import { sanitizeCredentials } from '../memory/secret-filter.js';
import { ClaimStore } from './claim-store.js';
import { selectClaimsForTask } from './claims.js';
import { KnowledgeWorkspaceStore } from './workspace-store.js';
import { loadKnowledgeWorkspace } from './workspace.js';
import { WorkflowStore } from './workflow-store.js';
import { OutcomeStore } from './outcome-store.js';
import { qualityFromOutcome, type OutcomeQuality } from './outcome-types.js';
import { selectWorkflows } from './workflows.js';
import type { AgentTarget } from '../types.js';
import { renderLongTermMemorySummary, selectLongTermMemoriesForTask } from '../memory/long-term.js';
import { governContextCandidates, type GovernancePlan } from './governor.js';
import type {
  ContextCandidateFreshness,
  ContextCandidateKind,
  ContextDeliveryTarget,
  ContextReceipt,
  ContextReceiptOmission,
  ContextReceiptSelection,
} from './context-assembly.js';
import type { CodeGraphOutline, CodeGraphProviderQuality } from '../codegraph/types.js';
import type { KnowledgeClaim, ClaimEvidenceRef } from './types.js';
import type { KnowledgePageRecord, KnowledgeWorkspace } from './workspace-types.js';
import type { WorkflowSelection } from './workflow-types.js';
import type { ObservationReader } from '../types.js';
import type { LongTermMemory, LongTermMemoryEvidence } from '../memory/long-term-types.js';

export type WorksetCautionKind =
  | 'dirty-worktree'
  | 'incomplete-scan'
  | 'suspect-code-memory'
  | 'stale-code-memory'
  | 'claim-conflict'
  | 'claim-needs-review'
  | 'workflow-failed-verification'
  | 'codegraph-refresh-queued'
  | 'codegraph-refresh-failed'
  | 'external-codegraph-fallback';

export interface WorksetCaution {
  kind: WorksetCautionKind;
  message: string;
}

export interface WorksetClaim {
  id: string;
  assertion: string;
  status: KnowledgeClaim['status'];
  reviewState: KnowledgeClaim['reviewState'];
  confidence: number;
  evidenceRefs: string[];
  reason: string;
}

export interface WorksetPage {
  id: string;
  title: string;
  relativePath: string;
  claimIds: string[];
  reason: string;
}

export interface WorksetWorkflow {
  id: string;
  title: string;
  reason: string[];
  firstPhase: {
    id: string;
    title: string;
    instructions: string;
  };
  verificationGates: string[];
  cautions: string[];
}

/**
 * A task-scoped plan assembled from existing workflow and wiki assets. It is
 * descriptive rather than an authorization boundary: host agents retain their
 * own tool and approval policies.
 */
export interface WorksetAgentLoadout {
  agent: AgentTarget;
  workflowIds: string[];
  requiredContext: string[];
  allowedTools: string[];
}

export interface WorksetMemorySource {
  id: number;
  title: string;
  type: string;
  status: 'current' | 'suspect' | 'stale' | 'unbound';
  path?: string;
  symbol?: string;
  reason?: string;
}

/** A task-matching curated long-term item. The full record stays behind CLI detail. */
export interface WorksetLongTermMemory {
  id: string;
  kind: LongTermMemory['kind'];
  scope: LongTermMemory['scope'];
  state: LongTermMemory['state'];
  quality: OutcomeQuality;
  title: string;
  summary: string;
  evidenceRefs: string[];
  reason: string;
}

/** Prior-work evidence selected only for an explicit or inferred continuation. */
export interface WorksetContinuation {
  previousSession?: {
    id: string;
    agent?: string;
    endedAt?: string;
    summary: string;
  };
  memories: Array<{
    id: number;
    title: string;
    type: string;
    detail?: string;
  }>;
  /** Recent host-native compaction evidence, kept distinct from durable memory. */
  compactCheckpoint?: {
    id: string;
    agent: string;
    captureKind: 'native-summary' | 'lifecycle';
    reason: 'manual' | 'auto' | 'unknown';
    completedAt?: string;
    summary: string;
  };
}

/** A small, exact file-level delta between the two latest complete Code State snapshots. */
export interface WorksetCodeEvolution {
  fromSnapshotId: string;
  toSnapshotId: string;
  changes: Array<{ path: string; kind: 'added' | 'modified' | 'removed' }>;
  directlyConnectedPaths: string[];
  /** Current stale memory bindings directly tied to the changed file paths. */
  affectedMemoryCount?: number;
  truncated: boolean;
}

export interface TaskWorkset {
  version: '1.3';
  task: string;
  lens: string;
  /** Always-on "who you are and what this workspace is doing" block. */
  alwaysOn?: {
    profile: string[];
    state?: string;
    durable: string[];
  };
  currentFacts: string[];
  continuation?: WorksetContinuation;
  codeState?: string;
  codeEvolution?: WorksetCodeEvolution;
  startHere: string[];
  /** Bounded task-specific relations from a validated local semantic graph. */
  semanticCode?: CodeGraphOutline;
  reliableMemory: WorksetMemorySource[];
  cautionMemory: WorksetMemorySource[];
  hiddenCautionMemoryCount: number;
  claims: WorksetClaim[];
  pages: WorksetPage[];
  durableMemory: WorksetLongTermMemory[];
  workflows: WorksetWorkflow[];
  agentLoadout?: WorksetAgentLoadout;
  cautions: WorksetCaution[];
  verification: string[];
  evidenceIds: string[];
  provenance: {
    snapshotId?: string;
    sourceEpoch?: number;
    workspaceId?: string;
    codeProvider?: CodeGraphProviderQuality;
  };
  budget: {
    maxTokens: number;
    tokenCount: number;
    omitted: string[];
  };
  /** Privacy-safe selection metadata for diagnostics, never appended to the prompt. */
  receipt: ContextReceipt;
  prompt: string;
}

export interface BuildTaskWorksetInput {
  projectId: string;
  dataDir: string;
  task?: string;
  /** Optional target used to select workflows explicitly compatible with this agent. */
  agent?: AgentTarget;
  lens: string;
  currentFacts?: string[];
  continuation?: WorksetContinuation;
  codeState?: string;
  codeEvolution?: WorksetCodeEvolution;
  startHere: string[];
  semanticCode?: CodeGraphOutline;
  providerQuality?: CodeGraphProviderQuality;
  reliableMemory?: WorksetMemorySource[];
  cautionMemory?: WorksetMemorySource[];
  hiddenCautionMemoryCount?: number;
  verificationHints: string[];
  worktreeDirty: boolean;
  snapshot?: {
    id?: string;
    sourceEpoch?: number;
    worktreeState?: 'clean' | 'dirty' | 'unavailable';
    incomplete?: boolean;
  };
  freshness?: {
    suspect: number;
    stale: number;
  };
  runtimeCautions?: WorksetCaution[];
  /** Always-on "who you are and what this workspace is doing" lines. */
  alwaysOn?: {
    profile: string[];
    state?: string;
    durable: string[];
  };
  /** Reader identity used only for team-scoped durable memory filtering. */
  reader?: ObservationReader;
  maxTokens?: number;
  /** Delivery surface controls receipt semantics without changing prompt shape. */
  deliveryTarget?: ContextDeliveryTarget;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function short(text: string, budget = 28): string {
  const safe = sanitizeCredentials(text).replace(/\s+/g, ' ').trim();
  return countTextTokens(safe) <= budget ? safe : truncateToTokenBudget(safe, budget);
}

// A continuation anchor often contains the exact flag, path, or command that
// makes the handoff actionable. Preserve a little more of it than generic
// display detail; the enclosing Workset budget still decides whether it fits.
const CONTINUATION_DETAIL_TOKEN_BUDGET = 20;

function claimAssertion(claim: KnowledgeClaim): string {
  return short([claim.subject, claim.predicate, claim.objectValue].join(' '));
}

async function preferredWorkspace(projectId: string, dataDir: string): Promise<KnowledgeWorkspace | undefined> {
  const [versioned, local] = await Promise.all([
    loadKnowledgeWorkspace({ projectId, dataDir, mode: 'versioned' }),
    loadKnowledgeWorkspace({ projectId, dataDir, mode: 'local' }),
  ]);
  return versioned ?? local;
}

function mapClaimCaution(kind: string): WorksetCaution | undefined {
  if (kind === 'claim-conflict') {
    return { kind, message: 'A task-matching claim conflicts with another active assertion.' };
  }
  if (kind === 'claim-needs-review') {
    return { kind, message: 'A task-matching claim needs review before it is treated as current.' };
  }
  return undefined;
}

function snapshotCautions(input: BuildTaskWorksetInput): WorksetCaution[] {
  const cautions: WorksetCaution[] = [];
  if (input.worktreeDirty || input.snapshot?.worktreeState === 'dirty') {
    cautions.push({
      kind: 'dirty-worktree',
      message: 'The Git worktree has uncommitted changes; current files outrank stored knowledge.',
    });
  }
  if (input.snapshot?.incomplete) {
    cautions.push({
      kind: 'incomplete-scan',
      message: 'The latest Code Memory scan is incomplete; inspect skipped or changed code directly.',
    });
  }
  if ((input.freshness?.suspect ?? 0) > 0) {
    cautions.push({
      kind: 'suspect-code-memory',
      message: String(input.freshness!.suspect) + ' suspect code-memory link(s) need current-source verification.',
    });
  }
  if ((input.freshness?.stale ?? 0) > 0) {
    cautions.push({
      kind: 'stale-code-memory',
      message: String(input.freshness!.stale) + ' code-memory link(s) are stale and should not guide edits without rereading code.',
    });
  }
  return cautions;
}

function pageMatchesClaim(page: KnowledgePageRecord, claimIds: Set<string>): boolean {
  return page.status === 'active'
    && page.reviewState === 'approved'
    && page.claimIds.some(claimId => claimIds.has(claimId));
}

function evidenceIdsForClaim(claim: Pick<KnowledgeClaim, 'id'>, evidence: ClaimEvidenceRef[]): string[] {
  return unique([
    'claim:' + claim.id,
    ...evidence.map(item => item.evidenceKind + ':' + item.evidenceId),
  ]);
}

function workflowOutput(selection: WorkflowSelection): WorksetWorkflow {
  const gates = unique([
    ...selection.workflow.verificationGates,
    ...selection.firstPhase.verificationGates,
  ]).slice(0, 3);
  return {
    id: selection.workflow.id,
    title: selection.workflow.title,
    reason: selection.reasons,
    firstPhase: {
      id: selection.firstPhase.id,
      title: selection.firstPhase.title,
      instructions: short(selection.firstPhase.instructions || selection.firstPhase.title, 28),
    },
    verificationGates: gates.map(gate => short(gate, 20)),
    cautions: selection.cautions.map(caution => short(caution, 22)),
  };
}

function workflowLoadout(agent: AgentTarget | undefined, selections: WorkflowSelection[]): WorksetAgentLoadout | undefined {
  if (!agent) return undefined;
  return {
    agent,
    workflowIds: selections.map(selection => selection.workflow.id),
    requiredContext: unique(selections.flatMap(selection => selection.workflow.requiredContext))
      .map(item => short(item, 18)).slice(0, 4),
    allowedTools: unique(selections.flatMap(selection => selection.workflow.allowedTools))
      .map(item => short(item, 12)).slice(0, 6),
  };
}

function appendLine(
  lines: string[],
  candidate: string,
  maxTokens: number,
  omitted: string[],
  omittedKind: string,
  selected?: ContextReceiptSelection[],
  receiptSelection?: ContextReceiptSelection,
): boolean {
  const next = lines.length ? lines.join('\n') + '\n' + candidate : candidate;
  if (countTextTokens(next) <= maxTokens) {
    lines.push(candidate);
    if (receiptSelection) selected?.push(receiptSelection);
    return true;
  }
  omitted.push(omittedKind);
  return false;
}

function freshnessForMemory(status: WorksetMemorySource['status']): ContextCandidateFreshness {
  if (status === 'current' || status === 'suspect' || status === 'stale') return status;
  return 'unknown';
}

function receiptOmissionKind(raw: string): ContextCandidateKind | undefined {
  if (raw.includes('continuation')) return 'continuation';
  if (raw.includes('task')) return 'task';
  if (raw.includes('fact')) return 'current-fact';
  if (raw.includes('state')) return 'code-state';
  if (raw.includes('semantic')) return 'semantic-code';
  if (raw.includes('start')) return 'start-here';
  if (raw.includes('durable-memory')) return 'durable-memory';
  if (raw.includes('memory')) return 'memory';
  if (raw.includes('claim')) return 'claim';
  if (raw.includes('knowledge-page')) return 'knowledge-page';
  if (raw.includes('workflow')) return 'workflow';
  if (raw.includes('verification')) return 'verification';
  if (raw.includes('caution')) return 'caution';
  return undefined;
}

function receiptOmissions(omitted: string[], hiddenCautionMemoryCount: number): ContextReceiptOmission[] {
  const counts = new Map<ContextCandidateKind, number>();
  for (const raw of omitted) {
    const kind = receiptOmissionKind(raw);
    if (!kind || raw.endsWith('-heading')) continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const receipt: ContextReceiptOmission[] = [...counts.entries()].map(([kind, count]) => ({
    kind,
    reason: 'token-budget',
    count,
  }));
  if (hiddenCautionMemoryCount > 0) {
    receipt.push({
      kind: 'caution',
      reason: 'hidden-by-task-lens',
      count: hiddenCautionMemoryCount,
    });
  }
  return receipt;
}

function scheduledActions(cautions: WorksetCaution[]): string[] {
  return cautions
    .filter(caution => caution.kind === 'codegraph-refresh-queued')
    .map(caution => short(caution.message, 28));
}

function isGovernedDelivery(disposition: GovernancePlan['decisions'][number]['disposition']): boolean {
  return disposition === 'include' || disposition === 'compact';
}

/**
 * Optional knowledge is where stale or over-confident context does the most
 * harm. Qualify it before prompt rendering; current project facts and cautions
 * remain visible so the agent can still inspect live source.
 */
function governOptionalArtifacts(input: {
  reliableMemory: WorksetMemorySource[];
  claims: WorksetClaim[];
  durableMemory: WorksetLongTermMemory[];
  workflows: WorksetWorkflow[];
}): {
  plan: GovernancePlan;
  reliableMemory: WorksetMemorySource[];
  claims: WorksetClaim[];
  durableMemory: WorksetLongTermMemory[];
  workflows: WorksetWorkflow[];
} {
  const candidates = [
    ...input.reliableMemory.map((memory, index) => ({
      kind: 'memory' as const,
      id: 'memory:' + memory.id,
      estimatedTokens: 10,
      relevance: Math.max(0.2, 0.9 - index * 0.1),
      scopeAllowed: true,
      freshness: freshnessForMemory(memory.status),
      trust: 'historical' as const,
      quality: memory.status === 'current' ? 'verified' as const : 'degraded' as const,
    })),
    ...input.claims.map((claim, index) => ({
      kind: 'claim' as const,
      id: 'claim:' + claim.id,
      estimatedTokens: 12,
      relevance: Math.max(0.2, 0.95 - index * 0.1),
      scopeAllowed: true,
      freshness: claim.status === 'active' ? 'current' as const : 'unknown' as const,
      trust: 'source-backed' as const,
      quality: claim.reviewState === 'approved' ? 'verified' as const : 'probationary' as const,
      conflict: claim.status === 'disputed' ? 'confirmed' as const : 'none' as const,
      evidenceCount: claim.evidenceRefs.length,
    })),
    ...input.durableMemory.map((memory, index) => ({
      kind: 'durable-memory' as const,
      id: 'durable:' + memory.id,
      estimatedTokens: 14,
      relevance: Math.max(0.2, 0.8 - index * 0.1),
      scopeAllowed: true,
      freshness: memory.state === 'approved' ? 'current' as const : 'unknown' as const,
      trust: 'source-backed' as const,
      quality: memory.quality,
      evidenceCount: memory.evidenceRefs.length,
    })),
    ...input.workflows.map((workflow, index) => ({
      kind: 'workflow' as const,
      id: 'workflow:' + workflow.id,
      estimatedTokens: 14,
      relevance: Math.max(0.2, 0.85 - index * 0.1),
      scopeAllowed: true,
      freshness: 'current' as const,
      trust: 'source-backed' as const,
      quality: 'verified' as const,
    })),
  ];
  // Prompt rendering owns the final whole-item token budget. This preflight
  // only decides whether optional evidence is safe enough to render at all.
  const plan = governContextCandidates(candidates, Number.MAX_SAFE_INTEGER);
  const permitted = new Set(plan.decisions
    .filter(decision => isGovernedDelivery(decision.disposition))
    .map(decision => decision.candidate.id));
  return {
    plan,
    reliableMemory: input.reliableMemory.filter(memory => permitted.has('memory:' + memory.id)),
    claims: input.claims.filter(claim => permitted.has('claim:' + claim.id)),
    durableMemory: input.durableMemory.filter(memory => permitted.has('durable:' + memory.id)),
    workflows: input.workflows.filter(workflow => permitted.has('workflow:' + workflow.id)),
  };
}

/**
 * Render a bounded prompt from whole evidence items. It never cuts a page,
 * workflow, or claim body into an untraceable partial fragment.
 */
export function renderTaskWorksetPrompt(input: Omit<TaskWorkset, 'prompt' | 'budget' | 'receipt'> & {
  budget?: Partial<TaskWorkset['budget']>;
}): {
  prompt: string;
  tokenCount: number;
  /** Compatibility summary: unique omission categories. */
  omitted: string[];
  /** Internal receipt input: one entry per candidate that did not fit. */
  omittedItems: string[];
  selected: ContextReceiptSelection[];
} {
  const maxTokens = input.budget?.maxTokens ?? 180;
  const omitted: string[] = [];
  const selected: ContextReceiptSelection[] = [];
  const lines: string[] = ['Memorix Autopilot Brief'];
  const task = short(input.task || 'Continue the current task.', 34);
  appendLine(lines, 'Task: ' + task, maxTokens, omitted, 'task-detail', selected, {
    kind: 'task',
    reason: 'current task supplied by the caller',
    trust: 'source-backed',
  });
  appendLine(lines, 'Task lens: ' + input.lens, maxTokens, omitted, 'lens');

  // Always-on block: the small "who you are and what this workspace is
  // doing" context every brief carries, mirroring the memory-native feel of
  // a per-session MEMORY.md. Lines are pre-truncated by the caller; the
  // enclosing budget still decides whether they fit.
  if (input.alwaysOn) {
    const hasAlwaysOn = input.alwaysOn.profile.length > 0
      || Boolean(input.alwaysOn.state)
      || input.alwaysOn.durable.length > 0;
    if (hasAlwaysOn) {
      appendLine(lines, '', maxTokens, omitted, 'always-on-heading');
      appendLine(lines, 'You and this workspace', maxTokens, omitted, 'always-on-heading');
      for (const profile of input.alwaysOn.profile.slice(0, 2)) {
        appendLine(lines, '- ' + short(profile, 26), maxTokens, omitted, 'always-on-profile', selected, {
          kind: 'memory',
          id: 'profile',
          reason: 'user profile memory',
          trust: 'source-backed',
        });
      }
      if (input.alwaysOn.state) {
        appendLine(lines, '- Recently: ' + short(input.alwaysOn.state, 40), maxTokens, omitted, 'always-on-state', selected, {
          kind: 'continuation',
          id: 'workspace-state',
          reason: 'latest session summary for this workspace',
          trust: 'historical',
        });
      }
      for (const durable of input.alwaysOn.durable.slice(0, 2)) {
        appendLine(lines, '- ' + short(durable, 28), maxTokens, omitted, 'always-on-durable', selected, {
          kind: 'durable-memory',
          id: 'durable-always',
          reason: 'recent durable memory for this workspace',
          trust: 'source-backed',
        });
      }
    }
  }

  const hasContinuation = Boolean(
    input.continuation?.previousSession
      || (input.continuation?.memories.length ?? 0) > 0
      || input.continuation?.compactCheckpoint,
  );
  if (hasContinuation && input.continuation) {
    appendLine(lines, '', maxTokens, omitted, 'continuation-heading');
    appendLine(lines, 'Resume from prior work', maxTokens, omitted, 'continuation-heading');
    if (input.continuation.previousSession) {
      const session = input.continuation.previousSession;
      const source = [session.agent, session.endedAt ? session.endedAt.slice(0, 10) : undefined]
        .filter(Boolean)
        .join(', ');
      appendLine(
        lines,
        '- Previous session' + (source ? ` (${source})` : '') + ': ' + short(session.summary, 44),
        maxTokens,
        omitted,
        'continuation-session',
        selected,
        {
          kind: 'continuation',
          id: 'session:' + session.id,
          reason: 'latest meaningful project session summary',
          trust: 'historical',
        },
      );
    }
    for (const memory of input.continuation.memories.slice(0, 3)) {
      const detail = memory.detail ? ': ' + short(memory.detail, CONTINUATION_DETAIL_TOKEN_BUDGET) : '';
      appendLine(
        lines,
        '- #' + memory.id + ' ' + memory.type + ': ' + short(memory.title, 18) + detail,
        maxTokens,
        omitted,
        'continuation-memory',
        selected,
        {
          kind: 'continuation',
          id: 'memory:' + memory.id,
          reason: 'durable prior-work memory',
          trust: 'historical',
        },
      );
    }
    if (input.continuation.compactCheckpoint) {
      const checkpoint = input.continuation.compactCheckpoint;
      const source = `${checkpoint.agent}, ${checkpoint.captureKind}, ${checkpoint.reason}`;
      appendLine(
        lines,
        '- Recent host compact checkpoint (' + source + '): ' + short(checkpoint.summary, 36),
        maxTokens,
        omitted,
        'continuation-compact-checkpoint',
        selected,
        {
          kind: 'continuation',
          id: 'compact:' + checkpoint.id,
          reason: 'recent host-native compact lifecycle evidence',
          trust: 'historical',
        },
      );
    }
  }

  if (input.cautions.length > 0 || input.cautionMemory.length > 0) {
    appendLine(lines, '', maxTokens, omitted, 'caution-heading');
    appendLine(lines, 'Cautions', maxTokens, omitted, 'caution-heading');
    for (const caution of input.cautions.slice(0, 6)) {
      appendLine(lines, '- ' + short(caution.message, 22), maxTokens, omitted, 'caution', selected, {
        kind: 'caution',
        id: 'caution:' + caution.kind,
        reason: 'current project caution',
        trust: 'source-backed',
      });
    }
    for (const memory of input.cautionMemory.slice(0, 3)) {
      const location = memory.path
        ? memory.path + (memory.symbol ? '#' + memory.symbol : '')
        : 'no current code location';
      const reason = memory.reason ? '; ' + short(memory.reason, 14) : '';
      appendLine(
        lines,
        '- #' + memory.id + ' ' + memory.status + ': ' + short(memory.title, 18) + ' (' + location + reason + ')',
        maxTokens,
        omitted,
        'caution-memory',
        selected,
        {
          kind: 'memory',
          id: 'memory:' + memory.id,
          reason: 'task-relevant memory requiring source verification',
          freshness: freshnessForMemory(memory.status),
          trust: 'historical',
        },
      );
    }
    if (input.hiddenCautionMemoryCount > 0) {
      appendLine(lines, '- Other unrelated warning details are hidden for this task.', maxTokens, omitted, 'hidden-caution-count');
    }
  }

  if (input.currentFacts.length > 0) {
    appendLine(lines, '', maxTokens, omitted, 'facts-heading');
    appendLine(lines, 'Current project facts', maxTokens, omitted, 'facts-heading');
    for (const fact of input.currentFacts.slice(0, 4)) {
      appendLine(lines, '- ' + short(fact, 40), maxTokens, omitted, 'current-fact', selected, {
        kind: 'current-fact',
        reason: 'current project state',
        trust: 'source-backed',
      });
    }
  }

  if (input.codeState) {
    appendLine(lines, '', maxTokens, omitted, 'state-heading');
    appendLine(lines, 'Project state', maxTokens, omitted, 'state-heading');
    appendLine(lines, input.codeState, maxTokens, omitted, 'code-state', selected, {
      kind: 'code-state',
      ...(input.provenance.snapshotId ? { id: 'snapshot:' + input.provenance.snapshotId } : {}),
      reason: 'latest available Code State snapshot',
      trust: 'source-backed',
    });
  }

  if (input.codeEvolution && input.codeEvolution.changes.length > 0) {
    appendLine(lines, '', maxTokens, omitted, 'code-evolution-heading');
    appendLine(lines, 'Code changes since prior scan', maxTokens, omitted, 'code-evolution-heading');
    for (const change of input.codeEvolution.changes.slice(0, 3)) {
      appendLine(
        lines,
        '- ' + change.kind + ': ' + change.path,
        maxTokens,
        omitted,
        'code-evolution-change',
        selected,
        {
          kind: 'code-state',
          id: 'snapshot:' + input.codeEvolution.toSnapshotId,
          reason: 'exact file hash change between complete CodeGraph snapshots',
          freshness: 'current',
          trust: 'source-backed',
        },
      );
    }
    for (const path of input.codeEvolution.directlyConnectedPaths.slice(0, 2)) {
      appendLine(
        lines,
        '- connected now: ' + path,
        maxTokens,
        omitted,
        'code-evolution-impact',
        selected,
        {
          kind: 'code-state',
          id: 'snapshot:' + input.codeEvolution.toSnapshotId,
          reason: 'bounded current CodeGraph impact relation',
          freshness: 'current',
          trust: 'derived',
        },
      );
    }
    if ((input.codeEvolution.affectedMemoryCount ?? 0) > 0) {
      appendLine(
        lines,
        '- ' + input.codeEvolution.affectedMemoryCount + ' stored memory link(s) reference this changed code; reread source before relying on their conclusions.',
        maxTokens,
        omitted,
        'code-evolution-stale-memory',
      );
    }
    if (input.codeEvolution.truncated) {
      appendLine(lines, '- More connected files exist; inspect CodeGraph before assuming complete impact.', maxTokens, omitted, 'code-evolution-truncated');
    }
  }

  if (input.startHere.length > 0) {
    appendLine(lines, '', maxTokens, omitted, 'start-heading');
    appendLine(lines, 'Start here', maxTokens, omitted, 'start-heading');
    for (const source of input.startHere.slice(0, 5)) {
      appendLine(lines, '- ' + source, maxTokens, omitted, 'start-here', selected, {
        kind: 'start-here',
        id: 'path:' + source,
        reason: 'task-lensed starting point',
        trust: 'derived',
      });
    }
  }

  if (input.reliableMemory.length > 0) {
    appendLine(lines, '', maxTokens, omitted, 'memory-heading');
    appendLine(lines, 'Reliable memory', maxTokens, omitted, 'memory-heading');
    for (const memory of input.reliableMemory.slice(0, 3)) {
      const location = memory.path
        ? memory.path + (memory.symbol ? '#' + memory.symbol : '')
        : 'no current code location';
      appendLine(
        lines,
        '- #' + memory.id + ' ' + memory.type + ': ' + short(memory.title, 18) + ' (' + location + ')',
        maxTokens,
        omitted,
        'reliable-memory',
        selected,
        {
          kind: 'memory',
          id: 'memory:' + memory.id,
          reason: 'current code-bound memory',
          freshness: freshnessForMemory(memory.status),
          trust: 'historical',
        },
      );
    }
  }

  if (input.claims.length > 0 || input.pages.length > 0) {
    appendLine(lines, '', maxTokens, omitted, 'knowledge-heading');
    appendLine(lines, 'Project knowledge', maxTokens, omitted, 'knowledge-heading');
    for (const claim of input.claims.slice(0, 3)) {
      appendLine(lines, '- ' + claim.assertion + ' [' + claim.id + ']', maxTokens, omitted, 'claim', selected, {
        kind: 'claim',
        id: 'claim:' + claim.id,
        reason: 'source-qualified task match',
        trust: 'source-backed',
      });
    }
    for (const page of input.pages.slice(0, 2)) {
      const supportsDeliveredClaim = page.claimIds.some(claimId => selected.some(item => (
        item.kind === 'claim' && item.id === 'claim:' + claimId
      )));
      if (!supportsDeliveredClaim) {
        omitted.push('knowledge-page-dependency');
        continue;
      }
      appendLine(lines, '- page: ' + page.relativePath, maxTokens, omitted, 'knowledge-page', selected, {
        kind: 'knowledge-page',
        id: 'page:' + page.id,
        reason: 'approved page linked to a selected claim',
        trust: 'source-backed',
      });
    }
  }

  if (input.durableMemory.length > 0) {
    appendLine(lines, '', maxTokens, omitted, 'durable-memory-heading');
    appendLine(lines, 'Durable memory', maxTokens, omitted, 'durable-memory-heading');
    for (const memory of input.durableMemory.slice(0, 3)) {
      appendLine(
        lines,
        '- ' + memory.kind + ' (' + memory.scope + ', ' + memory.state + '; ref durable:' + memory.id + '): ' + memory.summary,
        maxTokens,
        omitted,
        'durable-memory',
        selected,
        {
          kind: 'durable-memory',
          id: 'durable:' + memory.id,
          reason: memory.reason,
          trust: 'source-backed',
        },
      );
    }
  }

  if (input.workflows.length > 0) {
    appendLine(lines, '', maxTokens, omitted, 'workflow-heading');
    appendLine(lines, 'Project workflow', maxTokens, omitted, 'workflow-heading');
    for (const workflow of input.workflows.slice(0, 2)) {
      appendLine(
        lines,
        '- ' + workflow.title + ': ' + workflow.firstPhase.title + ' - ' + workflow.firstPhase.instructions,
        maxTokens,
        omitted,
        'workflow',
        selected,
        {
          kind: 'workflow',
          id: 'workflow:' + workflow.id,
          reason: 'task-matching project workflow',
          trust: 'source-backed',
        },
      );
    }
  }

  if (input.agentLoadout) {
    appendLine(lines, '', maxTokens, omitted, 'agent-loadout-heading');
    appendLine(lines, 'Agent loadout (' + input.agentLoadout.agent + ')', maxTokens, omitted, 'agent-loadout-heading');
    for (const required of input.agentLoadout.requiredContext.slice(0, 2)) {
      appendLine(lines, '- Need: ' + required, maxTokens, omitted, 'agent-loadout-context');
    }
    if (input.agentLoadout.allowedTools.length > 0) {
      appendLine(
        lines,
        '- Workflow tools: ' + input.agentLoadout.allowedTools.join(', '),
        maxTokens,
        omitted,
        'agent-loadout-tools',
      );
    }
  }

  if (input.verification.length > 0) {
    appendLine(lines, '', maxTokens, omitted, 'verification-heading');
    appendLine(lines, 'Verify', maxTokens, omitted, 'verification-heading');
    for (const check of input.verification.slice(0, 4)) {
      appendLine(lines, '- ' + short(check, 20), maxTokens, omitted, 'verification', selected, {
        kind: 'verification',
        reason: 'task-lensed verification guidance',
        trust: 'derived',
      });
    }
  }

  // Semantic structure is useful, but it must never evict the task, current
  // facts, warnings, or reliable memory from a small Agent budget.
  if (input.semanticCode && (input.semanticCode.entryPoints.length > 0 || input.semanticCode.relations.length > 0)) {
    appendLine(lines, '', maxTokens, omitted, 'semantic-code-heading');
    appendLine(lines, 'Semantic code outline', maxTokens, omitted, 'semantic-code-heading');
    for (const relation of input.semanticCode.relations.slice(0, 2)) {
      const location = relation.from.path + (relation.line ? ':' + relation.line : '');
      appendLine(
        lines,
        '- ' + location + ': ' + short(relation.from.name, 12) + ' ' + short(relation.kind, 8) + ' ' + short(relation.to.name, 12),
        maxTokens,
        omitted,
        'semantic-relation',
        selected,
        {
          kind: 'semantic-code',
          id: 'code:' + location,
          reason: 'validated semantic code relation',
          trust: 'derived',
        },
      );
    }
    if (input.semanticCode.relations.length === 0) {
      for (const entry of input.semanticCode.entryPoints.slice(0, 2)) {
        const location = entry.path + (entry.startLine ? ':' + entry.startLine : '');
        appendLine(
          lines,
          '- ' + location + ': ' + short(entry.name, 16) + ' (' + short(entry.kind, 8) + ')',
          maxTokens,
          omitted,
          'semantic-entry',
          selected,
          {
            kind: 'semantic-code',
            id: 'code:' + location,
            reason: 'validated semantic code entry point',
            trust: 'derived',
          },
        );
      }
    }
  }

  return {
    prompt: lines.join('\n'),
    tokenCount: countTextTokens(lines.join('\n')),
    omitted: unique(omitted),
    omittedItems: omitted,
    selected,
  };
}

/**
 * Build a small, source-aware task Workset. Optional knowledge artifacts are
 * treated as enrichment: absent or invalid artifacts never prevent a code
 * context response.
 */
export async function buildTaskWorkset(input: BuildTaskWorksetInput): Promise<TaskWorkset> {
  const startedAt = Date.now();
  const task = input.task?.trim() ?? '';
  const maxTokens = Math.max(96, Math.min(Math.floor(input.maxTokens ?? 180), 320));
  const cautions = [...(input.runtimeCautions ?? []), ...snapshotCautions(input)];
  const claimStore = new ClaimStore();
  await claimStore.init(input.dataDir);
  const selection = task
    ? selectClaimsForTask(claimStore, {
      projectId: input.projectId,
      task,
      limit: 3,
      maxTokens: 68,
    })
    : { claims: [], cautions: [], tokenCount: 0, reasons: {} };
  for (const caution of selection.cautions) {
    const mapped = mapClaimCaution(caution);
    if (mapped) cautions.push(mapped);
  }

  const evidenceByClaim = new Map<string, ClaimEvidenceRef[]>();
  for (const claim of selection.claims) {
    evidenceByClaim.set(claim.id, claimStore.listEvidence(claim.id));
  }
  const claims: WorksetClaim[] = selection.claims.map(claim => ({
    id: claim.id,
    assertion: claimAssertion(claim),
    status: claim.status,
    reviewState: claim.reviewState,
    confidence: claim.confidence,
    evidenceRefs: evidenceByClaim.get(claim.id)!.map(item => item.id),
    reason: selection.reasons[claim.id] ?? 'source-qualified task match',
  }));

  let durableMemory: WorksetLongTermMemory[] = [];
  let durableEvidence: LongTermMemoryEvidence[] = [];
  let outcomeStore: OutcomeStore | undefined;
  try {
    outcomeStore = new OutcomeStore();
    await outcomeStore.init(input.dataDir);
  } catch {
    // Outcome evidence enriches the decision; normal current-source context
    // remains usable if an older local database cannot expose it yet.
  }
  const claimQuality = outcomeStore
    ? outcomeStore.latestForCandidates(input.projectId, 'claim', claims.map(claim => claim.id))
    : new Map();
  for (const claim of claims) {
    const outcomeQuality = qualityFromOutcome(claimQuality.get(claim.id));
    if (outcomeQuality === 'degraded') claim.reviewState = 'needs-review';
  }
  if (task) {
    try {
      const selected = await selectLongTermMemoriesForTask({
        dataDir: input.dataDir,
        projectId: input.projectId,
        task,
        ...(input.reader?.agentId ? { agentId: input.reader.agentId } : {}),
        ...(input.reader?.isTeamMember ? { isTeamMember: true } : {}),
        limit: 3,
      });
      const durableQuality = outcomeStore
        ? outcomeStore.latestForCandidates(input.projectId, 'durable-memory', selected.map(item => item.memory.id))
        : new Map();
      durableMemory = selected.map(item => ({
        id: item.memory.id,
        kind: item.memory.kind,
        scope: item.memory.scope,
        state: item.memory.state,
        quality: qualityFromOutcome(durableQuality.get(item.memory.id))
          ?? (item.memory.state === 'approved' ? 'verified' : 'probationary'),
        title: item.memory.title,
        summary: renderLongTermMemorySummary(item.memory, 20),
        evidenceRefs: item.evidence.map(evidence => evidence.id),
        reason: item.reason,
      }));
      durableEvidence = selected.flatMap(item => item.evidence);
    } catch {
      // Long-term memory is optional enrichment; a local identity or schema
      // problem must never block current source/code context delivery.
    }
  }

  let workspace: KnowledgeWorkspace | undefined;
  let pages: WorksetPage[] = [];
  let workflows: WorksetWorkflow[] = [];
  let workflowSelections: WorkflowSelection[] = [];
  try {
    workspace = await preferredWorkspace(input.projectId, input.dataDir);
    if (workspace) {
      const workspaceStore = new KnowledgeWorkspaceStore();
      await workspaceStore.init(input.dataDir);
      const selectedClaimIds = new Set(selection.claims.map(claim => claim.id));
      pages = workspaceStore.listPages(workspace.id)
        .filter(page => pageMatchesClaim(page, selectedClaimIds))
        .slice(0, 2)
        .map(page => ({
          id: page.id,
          title: page.title,
          relativePath: page.relativePath,
          claimIds: page.claimIds.filter(claimId => selectedClaimIds.has(claimId)),
          reason: 'published page links to a selected claim',
        }));

      if (task) {
        const workflowStore = new WorkflowStore();
        await workflowStore.init(input.dataDir);
        workflowSelections = selectWorkflows({
          workflows: workflowStore.listWorkflows(workspace.id, 'active'),
          task,
          projectId: input.projectId,
          store: workflowStore,
          ...(input.agent ? { agent: input.agent } : {}),
          limit: 2,
        });
        workflows = workflowSelections.map(workflowOutput);
        for (const workflow of workflows) {
          for (const caution of workflow.cautions) {
            cautions.push({ kind: 'workflow-failed-verification', message: caution });
          }
        }
      }
    }
  } catch {
    // Knowledge is optional. Existing Code Memory remains usable without it.
  }

  const verification = unique([
    ...workflows.flatMap(workflow => workflow.verificationGates),
    ...input.verificationHints,
  ]).slice(0, 4);
  const normalizedCautions = unique(cautions.map(caution => caution.kind))
    .map(kind => cautions.find(caution => caution.kind === kind)!)
    .slice(0, 6);
  const governed = governOptionalArtifacts({
    reliableMemory: input.reliableMemory?.slice(0, 3) ?? [],
    claims,
    durableMemory,
    workflows,
  });
  const governedDurableIds = new Set(governed.durableMemory.map(memory => memory.id));
  const agentLoadout = workflowLoadout(
    input.agent,
    workflowSelections.filter(selection => governed.workflows.some(workflow => workflow.id === selection.workflow.id)),
  );
  const evidenceIds = unique(governed.claims.flatMap(claim => evidenceIdsForClaim(
    claim,
    evidenceByClaim.get(claim.id) ?? [],
  )).concat(
    governed.durableMemory.map(memory => 'durable:' + memory.id),
    durableEvidence
      .filter(evidence => governedDurableIds.has(evidence.memoryId))
      .map(evidence => 'durable-evidence:' + evidence.id),
  ));
  const continuation = input.continuation
    && (
      input.continuation.previousSession
      || input.continuation.memories.length > 0
      || input.continuation.compactCheckpoint
    )
    ? {
      ...(input.continuation.previousSession
        ? {
          previousSession: {
            ...input.continuation.previousSession,
            summary: short(input.continuation.previousSession.summary, 52),
          },
        }
        : {}),
      memories: input.continuation.memories.slice(0, 3).map((memory) => ({
        ...memory,
        title: short(memory.title, 20),
        ...(memory.detail ? { detail: short(memory.detail, CONTINUATION_DETAIL_TOKEN_BUDGET) } : {}),
      })),
      ...(input.continuation.compactCheckpoint
        ? {
          compactCheckpoint: {
            ...input.continuation.compactCheckpoint,
            summary: short(input.continuation.compactCheckpoint.summary, 44),
          },
        }
        : {}),
    }
    : undefined;
  const base = {
    version: '1.3' as const,
    task,
    lens: input.lens,
    ...(input.alwaysOn
      && (
        input.alwaysOn.profile.length > 0
        || input.alwaysOn.state
        || input.alwaysOn.durable.length > 0
      )
      ? { alwaysOn: input.alwaysOn }
      : {}),
    currentFacts: input.currentFacts?.map(fact => fact.startsWith('Historical note:')
      ? short(fact, 48)
      : short(fact, 28)).slice(0, 4) ?? [],
    ...(continuation ? { continuation } : {}),
    ...(input.codeState ? { codeState: short(input.codeState, 28) } : {}),
    ...(input.codeEvolution ? { codeEvolution: input.codeEvolution } : {}),
    startHere: unique(input.startHere).slice(0, 5),
    ...(input.semanticCode ? { semanticCode: input.semanticCode } : {}),
    reliableMemory: governed.reliableMemory,
    cautionMemory: input.cautionMemory?.slice(0, 3) ?? [],
    hiddenCautionMemoryCount: input.hiddenCautionMemoryCount ?? 0,
    claims: governed.claims,
    pages: pages.filter(page => page.claimIds.some(claimId => governed.claims.some(claim => claim.id === claimId))),
    durableMemory: governed.durableMemory,
    workflows: governed.workflows,
    ...(agentLoadout
      ? { agentLoadout }
      : {}),
    cautions: normalizedCautions,
    verification,
    evidenceIds,
    provenance: {
      ...(input.snapshot?.id ? { snapshotId: input.snapshot.id } : {}),
      ...(input.snapshot?.sourceEpoch !== undefined ? { sourceEpoch: input.snapshot.sourceEpoch } : {}),
      ...(workspace ? { workspaceId: workspace.id } : {}),
      ...(input.providerQuality ? { codeProvider: input.providerQuality } : {}),
    },
  };
  const rendered = renderTaskWorksetPrompt({
    ...base,
    budget: { maxTokens },
  });
  const receipt: ContextReceipt = {
    version: '1.3',
    target: input.deliveryTarget ?? 'project-context',
    elapsedMs: Math.max(0, Date.now() - startedAt),
    budget: {
      maxTokens,
      tokenCount: rendered.tokenCount,
    },
    selected: rendered.selected,
    omitted: receiptOmissions(rendered.omittedItems, base.hiddenCautionMemoryCount),
    governance: {
      scope: 'optional-evidence',
      mode: governed.plan.mode,
      decisions: governed.plan.decisions.map(decision => ({
        kind: decision.candidate.kind,
        ...(decision.candidate.id ? { id: decision.candidate.id } : {}),
        disposition: decision.disposition,
        reasons: decision.reasons,
      })),
      cautions: governed.plan.cautions,
    },
    scheduledActions: scheduledActions(normalizedCautions),
  };
  return {
    ...base,
    budget: {
      maxTokens,
      tokenCount: rendered.tokenCount,
      omitted: rendered.omitted,
    },
    receipt,
    prompt: rendered.prompt,
  };
}
