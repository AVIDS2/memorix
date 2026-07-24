import { countTextTokens, truncateToTokenBudget } from '../compact/token-budget.js';
import { sanitizeCredentials } from '../memory/secret-filter.js';
import { ClaimStore } from './claim-store.js';
import { selectClaimsForTask } from './claims.js';
import { KnowledgeWorkspaceStore } from './workspace-store.js';
import { loadKnowledgeWorkspace } from './workspace.js';
import { WorkflowStore } from './workflow-store.js';
import { selectWorkflows } from './workflows.js';
import type { CodeGraphProviderQuality, ExternalCodeGraphOutline } from '../codegraph/types.js';
import type { KnowledgeClaim, ClaimEvidenceRef } from './types.js';
import type { KnowledgePageRecord, KnowledgeWorkspace } from './workspace-types.js';
import type { WorkflowSelection } from './workflow-types.js';

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

/**
 * Research-facing prompt delivery profiles. They change only what the agent
 * receives from an already-built Workset; they never change indexing,
 * retrieval, storage, or background maintenance.
 */
export const TASK_WORKSET_DELIVERY_PROFILES = [
  'full',
  'no-freshness',
  'no-current-state',
  'no-semantic-code',
  'no-knowledge',
  'no-workflow',
] as const;

export type TaskWorksetDeliveryProfile = typeof TASK_WORKSET_DELIVERY_PROFILES[number];

export interface TaskWorksetDelivery {
  profile: TaskWorksetDeliveryProfile;
  prompt: string;
  tokenCount: number;
  omitted: string[];
  /** Stable component names removed before the normal Workset renderer ran. */
  suppressed: string[];
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

export interface WorksetMemorySource {
  id: number;
  title: string;
  type: string;
  status: 'current' | 'suspect' | 'stale' | 'unbound';
  path?: string;
  symbol?: string;
  reason?: string;
}

export interface TaskWorkset {
  version: '1.2';
  task: string;
  lens: string;
  currentFacts: string[];
  codeState?: string;
  startHere: string[];
  /** Bounded task-specific relations from a validated local semantic graph. */
  semanticCode?: ExternalCodeGraphOutline;
  reliableMemory: WorksetMemorySource[];
  cautionMemory: WorksetMemorySource[];
  hiddenCautionMemoryCount: number;
  claims: WorksetClaim[];
  pages: WorksetPage[];
  workflows: WorksetWorkflow[];
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
  prompt: string;
}

export interface BuildTaskWorksetInput {
  projectId: string;
  dataDir: string;
  task?: string;
  lens: string;
  currentFacts?: string[];
  codeState?: string;
  startHere: string[];
  semanticCode?: ExternalCodeGraphOutline;
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
  maxTokens?: number;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function short(text: string, budget = 28): string {
  const safe = sanitizeCredentials(text).replace(/\s+/g, ' ').trim();
  return countTextTokens(safe) <= budget ? safe : truncateToTokenBudget(safe, budget);
}

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

function evidenceIdsForClaim(claim: KnowledgeClaim, evidence: ClaimEvidenceRef[]): string[] {
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

function appendLine(
  lines: string[],
  candidate: string,
  maxTokens: number,
  omitted: string[],
  omittedKind: string,
): boolean {
  const next = lines.length ? lines.join('\n') + '\n' + candidate : candidate;
  if (countTextTokens(next) <= maxTokens) {
    lines.push(candidate);
    return true;
  }
  omitted.push(omittedKind);
  return false;
}

/**
 * Render a bounded prompt from whole evidence items. It never cuts a page,
 * workflow, or claim body into an untraceable partial fragment.
 */
export function renderTaskWorksetPrompt(input: Omit<TaskWorkset, 'prompt' | 'budget'> & {
  budget?: Partial<TaskWorkset['budget']>;
}): { prompt: string; tokenCount: number; omitted: string[] } {
  const maxTokens = input.budget?.maxTokens ?? 180;
  const omitted: string[] = [];
  const lines: string[] = ['Memorix Autopilot Brief'];
  const task = short(input.task || 'Continue the current task.', 34);
  appendLine(lines, 'Task: ' + task, maxTokens, omitted, 'task-detail');
  appendLine(lines, 'Task lens: ' + input.lens, maxTokens, omitted, 'lens');

  if (input.cautions.length > 0 || input.cautionMemory.length > 0) {
    appendLine(lines, '', maxTokens, omitted, 'caution-heading');
    appendLine(lines, 'Cautions', maxTokens, omitted, 'caution-heading');
    for (const caution of input.cautions.slice(0, 6)) {
      appendLine(lines, '- ' + short(caution.message, 22), maxTokens, omitted, 'caution');
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
      appendLine(lines, '- ' + short(fact, 40), maxTokens, omitted, 'current-fact');
    }
  }

  if (input.codeState) {
    appendLine(lines, '', maxTokens, omitted, 'state-heading');
    appendLine(lines, 'Project state', maxTokens, omitted, 'state-heading');
    appendLine(lines, input.codeState, maxTokens, omitted, 'code-state');
  }

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
        );
      }
    }
  }

  if (input.startHere.length > 0) {
    appendLine(lines, '', maxTokens, omitted, 'start-heading');
    appendLine(lines, 'Start here', maxTokens, omitted, 'start-heading');
    for (const source of input.startHere.slice(0, 5)) {
      appendLine(lines, '- ' + source, maxTokens, omitted, 'start-here');
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
      );
    }
  }

  if (input.claims.length > 0 || input.pages.length > 0) {
    appendLine(lines, '', maxTokens, omitted, 'knowledge-heading');
    appendLine(lines, 'Project knowledge', maxTokens, omitted, 'knowledge-heading');
    for (const claim of input.claims.slice(0, 3)) {
      appendLine(lines, '- ' + claim.assertion + ' [' + claim.id + ']', maxTokens, omitted, 'claim');
    }
    for (const page of input.pages.slice(0, 2)) {
      appendLine(lines, '- page: ' + page.relativePath, maxTokens, omitted, 'knowledge-page');
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
      );
    }
  }

  if (input.verification.length > 0) {
    appendLine(lines, '', maxTokens, omitted, 'verification-heading');
    appendLine(lines, 'Verify', maxTokens, omitted, 'verification-heading');
    for (const check of input.verification.slice(0, 4)) {
      appendLine(lines, '- ' + short(check, 20), maxTokens, omitted, 'verification');
    }
  }

  return {
    prompt: lines.join('\n'),
    tokenCount: countTextTokens(lines.join('\n')),
    omitted: unique(omitted),
  };
}

const FRESHNESS_CAUTION_KINDS = new Set<WorksetCautionKind>([
  'suspect-code-memory',
  'stale-code-memory',
  'incomplete-scan',
  'codegraph-refresh-queued',
  'codegraph-refresh-failed',
  'external-codegraph-fallback',
]);

const CURRENT_STATE_CAUTION_KINDS = new Set<WorksetCautionKind>([
  'dirty-worktree',
  'incomplete-scan',
  'codegraph-refresh-queued',
  'codegraph-refresh-failed',
  'external-codegraph-fallback',
]);

const KNOWLEDGE_CAUTION_KINDS = new Set<WorksetCautionKind>([
  'claim-conflict',
  'claim-needs-review',
]);

/**
 * Render a counterfactual agent-facing delivery without changing the Workset
 * that the product formed. This is intentionally not a product-mode switch:
 * it supports controlled evaluation of which delivered evidence is useful.
 */
export function renderTaskWorksetDelivery(
  workset: TaskWorkset,
  profile: TaskWorksetDeliveryProfile = 'full',
): TaskWorksetDelivery {
  if (profile === 'full') {
    return {
      profile,
      prompt: workset.prompt,
      tokenCount: workset.budget.tokenCount,
      omitted: [...workset.budget.omitted],
      suppressed: [],
    };
  }

  const { prompt: _prompt, budget, ...base } = workset;
  let input: Omit<TaskWorkset, 'prompt' | 'budget'> = base;
  let suppressed: string[];

  switch (profile) {
    case 'no-freshness':
      input = {
        ...input,
        cautionMemory: [],
        hiddenCautionMemoryCount: 0,
        cautions: input.cautions.filter(caution => !FRESHNESS_CAUTION_KINDS.has(caution.kind)),
      };
      suppressed = ['caution-memory', 'freshness-cautions'];
      break;
    case 'no-current-state':
      input = {
        ...input,
        currentFacts: [],
        codeState: undefined,
        cautions: input.cautions.filter(caution => !CURRENT_STATE_CAUTION_KINDS.has(caution.kind)),
      };
      suppressed = ['current-facts', 'code-state', 'current-state-cautions'];
      break;
    case 'no-semantic-code':
      input = { ...input, semanticCode: undefined };
      suppressed = ['semantic-code'];
      break;
    case 'no-knowledge':
      input = {
        ...input,
        claims: [],
        pages: [],
        evidenceIds: [],
        cautions: input.cautions.filter(caution => !KNOWLEDGE_CAUTION_KINDS.has(caution.kind)),
      };
      suppressed = ['knowledge-claims', 'knowledge-pages', 'knowledge-cautions'];
      break;
    case 'no-workflow': {
      const workflowVerification = new Set(input.workflows.flatMap(workflow => workflow.verificationGates));
      input = {
        ...input,
        workflows: [],
        verification: input.verification.filter(check => !workflowVerification.has(check)),
        cautions: input.cautions.filter(caution => caution.kind !== 'workflow-failed-verification'),
      };
      suppressed = ['workflow', 'workflow-verification', 'workflow-cautions'];
      break;
    }
    default: {
      const exhaustive: never = profile;
      throw new Error(`Unsupported Task Workset delivery profile: ${exhaustive}`);
    }
  }

  const rendered = renderTaskWorksetPrompt({
    ...input,
    budget: { maxTokens: budget.maxTokens },
  });
  return {
    profile,
    prompt: rendered.prompt,
    tokenCount: rendered.tokenCount,
    omitted: rendered.omitted,
    suppressed,
  };
}

/**
 * Build a small, source-aware task Workset. Optional knowledge artifacts are
 * treated as enrichment: absent or invalid artifacts never prevent a code
 * context response.
 */
export async function buildTaskWorkset(input: BuildTaskWorksetInput): Promise<TaskWorkset> {
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

  let workspace: KnowledgeWorkspace | undefined;
  let pages: WorksetPage[] = [];
  let workflows: WorksetWorkflow[] = [];
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
        const selected = selectWorkflows({
          workflows: workflowStore.listWorkflows(workspace.id, 'active'),
          task,
          projectId: input.projectId,
          store: workflowStore,
          limit: 2,
        });
        workflows = selected.map(workflowOutput);
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

  const evidenceIds = unique(selection.claims.flatMap(claim => evidenceIdsForClaim(
    claim,
    evidenceByClaim.get(claim.id) ?? [],
  )));
  const verification = unique([
    ...workflows.flatMap(workflow => workflow.verificationGates),
    ...input.verificationHints,
  ]).slice(0, 4);
  const normalizedCautions = unique(cautions.map(caution => caution.kind))
    .map(kind => cautions.find(caution => caution.kind === kind)!)
    .slice(0, 6);
  const base = {
    version: '1.2' as const,
    task,
    lens: input.lens,
    currentFacts: input.currentFacts?.map(fact => fact.startsWith('Historical note:')
      ? short(fact, 48)
      : short(fact, 28)).slice(0, 4) ?? [],
    ...(input.codeState ? { codeState: short(input.codeState, 28) } : {}),
    startHere: unique(input.startHere).slice(0, 5),
    ...(input.semanticCode ? { semanticCode: input.semanticCode } : {}),
    reliableMemory: input.reliableMemory?.slice(0, 3) ?? [],
    cautionMemory: input.cautionMemory?.slice(0, 3) ?? [],
    hiddenCautionMemoryCount: input.hiddenCautionMemoryCount ?? 0,
    claims,
    pages,
    workflows,
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
  return {
    ...base,
    budget: {
      maxTokens,
      tokenCount: rendered.tokenCount,
      omitted: rendered.omitted,
    },
    prompt: rendered.prompt,
  };
}
