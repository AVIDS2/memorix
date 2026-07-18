import { ClaimStore } from '../knowledge/claim-store.js';
import { KnowledgeWorkspaceStore } from '../knowledge/workspace-store.js';
import { WorkflowStore } from '../knowledge/workflow-store.js';
import { MaintenanceJobStore, type MaintenanceJobSummary } from './maintenance-jobs.js';

export interface LifecycleDiagnostics {
  maintenance: {
    summary: MaintenanceJobSummary;
    failedJobs: Array<{
      id: string;
      kind: string;
      attempts: number;
      updatedAt: number;
      lastError?: string;
    }>;
  };
  claims: {
    total: number;
    active: number;
    unknown: number;
    needsReview: number;
    conflicts: number;
  };
  workspaces: Array<{
    id: string;
    mode: 'local' | 'versioned';
    status: string;
    pages: number;
    pendingProposals: number;
    lastCompiledAt?: string;
    lastLintedAt?: string;
  }>;
  workflows: {
    total: number;
    active: number;
    failedRuns: number;
  };
}

/**
 * Read-only operational summary for Doctor and dashboard surfaces. It exposes
 * lifecycle state, never maintenance payloads or workspace file contents.
 */
export async function collectLifecycleDiagnostics(input: {
  dataDir: string;
  projectId: string;
}): Promise<LifecycleDiagnostics> {
  const queue = new MaintenanceJobStore(input.dataDir);
  const maintenance = {
    summary: queue.summary(input.projectId),
    failedJobs: queue.list({ projectId: input.projectId, status: 'failed', limit: 5 }).map(job => ({
      id: job.id,
      kind: job.kind,
      attempts: job.attempts,
      updatedAt: job.updatedAt,
      ...(job.lastError ? { lastError: job.lastError } : {}),
    })),
  };

  const claims = new ClaimStore();
  const workspaces = new KnowledgeWorkspaceStore();
  const workflows = new WorkflowStore();
  await Promise.all([
    claims.init(input.dataDir),
    workspaces.init(input.dataDir),
    workflows.init(input.dataDir),
  ]);

  const projectClaims = claims.listClaims(input.projectId);
  const workspaceRecords = [
    workspaces.findWorkspace(input.projectId, 'versioned'),
    workspaces.findWorkspace(input.projectId, 'local'),
  ].filter((workspace): workspace is NonNullable<typeof workspace> => !!workspace);
  const workspaceDiagnostics = workspaceRecords.map(workspace => ({
    id: workspace.id,
    mode: workspace.mode,
    status: workspace.status,
    pages: workspaces.listPages(workspace.id).length,
    pendingProposals: workspaces.listProposals(workspace.id, 'pending').length,
    ...(workspace.lastCompiledAt ? { lastCompiledAt: workspace.lastCompiledAt } : {}),
    ...(workspace.lastLintedAt ? { lastLintedAt: workspace.lastLintedAt } : {}),
  }));
  const projectWorkflows = workspaceRecords.flatMap(workspace => workflows.listWorkflows(workspace.id));
  const runs = workflows.listRuns(input.projectId, undefined, 100);

  return {
    maintenance,
    claims: {
      total: projectClaims.length,
      active: projectClaims.filter(claim => claim.status === 'active').length,
      unknown: projectClaims.filter(claim => claim.status === 'unknown').length,
      needsReview: projectClaims.filter(claim => claim.reviewState === 'needs-review').length,
      conflicts: claims.listConflicts(input.projectId).length,
    },
    workspaces: workspaceDiagnostics,
    workflows: {
      total: projectWorkflows.length,
      active: projectWorkflows.filter(workflow => workflow.status === 'active').length,
      failedRuns: runs.filter(run => run.outcome === 'failed' || run.verificationVerdict === 'failed').length,
    },
  };
}
