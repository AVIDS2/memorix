import type { AgentTarget } from '../types.js';

export type WorkflowStatus = 'draft' | 'active' | 'archived';
export type WorkflowRunOutcome = 'passed' | 'failed' | 'cancelled' | 'in-progress';
export type WorkflowVerificationVerdict = 'passed' | 'failed' | 'not-run';

export interface WorkflowPhase {
  id: string;
  title: string;
  instructions: string;
  branches: string[];
  expectedOutputs: string[];
  verificationGates: string[];
}

/**
 * A canonical project workflow. The Markdown file is the readable source; the
 * SQLite copy exists only to make selection, run history, and diagnostics fast.
 */
export interface WorkflowSpec {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  status: WorkflowStatus;
  version: number;
  taskLenses: string[];
  triggers: string[];
  assumptions: string[];
  requiredContext: string[];
  guardrails: string[];
  allowedTools: string[];
  phases: WorkflowPhase[];
  verificationGates: string[];
  claimIds: string[];
  evidenceRefs: string[];
  codeRefs: string[];
  compatibleAgents: AgentTarget[];
  body: string;
  sourcePath: string;
  sourceHash: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  importedFrom?: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  projectId: string;
  task: string;
  startingSnapshotId?: string;
  selectedEvidence: string[];
  phaseState: Record<string, 'pending' | 'active' | 'passed' | 'failed' | 'skipped'>;
  outcome: WorkflowRunOutcome;
  verificationVerdict: WorkflowVerificationVerdict;
  failureReason?: string;
  startedAt: string;
  completedAt?: string;
}

export interface WorkflowRunInput {
  workflowId: string;
  projectId: string;
  task: string;
  startingSnapshotId?: string;
  selectedEvidence?: string[];
  phaseState?: WorkflowRun['phaseState'];
  outcome: WorkflowRunOutcome;
  verificationVerdict?: WorkflowVerificationVerdict;
  failureReason?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface WorkflowSelection {
  workflow: WorkflowSpec;
  score: number;
  reasons: string[];
  firstPhase: WorkflowPhase;
  cautions: string[];
}

export type WorkflowAdapterTarget = Extract<AgentTarget, 'codex' | 'claude-code' | 'cursor' | 'windsurf'>;
export type WorkflowAdapterStatus = 'create' | 'update' | 'unchanged' | 'conflict' | 'unsupported';

export interface WorkflowAdapterPreview {
  agent: AgentTarget;
  workflowId: string;
  targetPath?: string;
  content?: string;
  status: WorkflowAdapterStatus;
  reason: string;
}
