import { randomUUID } from 'node:crypto';
import { getDatabase } from '../store/sqlite-db.js';
import type {
  WorkflowRun,
  WorkflowRunInput,
  WorkflowRunOutcome,
  WorkflowSpec,
  WorkflowVerificationVerdict,
} from './workflow-types.js';

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function rowToWorkflow(row: any): WorkflowSpec {
  return parseJson<WorkflowSpec>(row.specJson, {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    description: '',
    status: row.status,
    version: row.version,
    taskLenses: [],
    triggers: [],
    assumptions: [],
    requiredContext: [],
    guardrails: [],
    allowedTools: [],
    phases: [],
    verificationGates: [],
    claimIds: [],
    evidenceRefs: [],
    codeRefs: [],
    compatibleAgents: [],
    body: '',
    sourcePath: row.sourcePath,
    sourceHash: row.sourceHash,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function rowToRun(row: any): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflowId,
    projectId: row.projectId,
    task: row.task,
    ...(optionalText(row.startingSnapshotId) ? { startingSnapshotId: row.startingSnapshotId } : {}),
    selectedEvidence: parseJson<string[]>(row.selectedEvidenceJson, []),
    phaseState: parseJson<WorkflowRun['phaseState']>(row.phaseStateJson, {}),
    outcome: row.outcome as WorkflowRunOutcome,
    verificationVerdict: row.verificationVerdict as WorkflowVerificationVerdict,
    ...(optionalText(row.failureReason) ? { failureReason: row.failureReason } : {}),
    startedAt: row.startedAt,
    ...(optionalText(row.completedAt) ? { completedAt: row.completedAt } : {}),
  };
}

export class WorkflowStore {
  private db: any = null;

  async init(dataDir: string): Promise<void> {
    this.db = getDatabase(dataDir);
  }

  upsertWorkflow(workflow: WorkflowSpec): WorkflowSpec {
    this.db.prepare(
      'INSERT INTO knowledge_workflows (id, workspaceId, sourcePath, title, status, version, sourceHash, contentHash, specJson, importedFrom, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspaceId, sourcePath) DO UPDATE SET id = excluded.id, title = excluded.title, status = excluded.status, version = excluded.version, sourceHash = excluded.sourceHash, contentHash = excluded.contentHash, specJson = excluded.specJson, importedFrom = excluded.importedFrom, updatedAt = excluded.updatedAt',
    ).run(
      workflow.id,
      workflow.workspaceId,
      workflow.sourcePath,
      workflow.title,
      workflow.status,
      workflow.version,
      workflow.sourceHash,
      workflow.contentHash,
      JSON.stringify(workflow),
      workflow.importedFrom ?? null,
      workflow.createdAt,
      workflow.updatedAt,
    );
    return this.getWorkflowByPath(workflow.workspaceId, workflow.sourcePath)!;
  }

  getWorkflow(id: string): WorkflowSpec | undefined {
    const row = this.db.prepare('SELECT * FROM knowledge_workflows WHERE id = ?').get(id);
    return row ? rowToWorkflow(row) : undefined;
  }

  getWorkflowByPath(workspaceId: string, sourcePath: string): WorkflowSpec | undefined {
    const row = this.db.prepare('SELECT * FROM knowledge_workflows WHERE workspaceId = ? AND sourcePath = ?').get(workspaceId, sourcePath);
    return row ? rowToWorkflow(row) : undefined;
  }

  listWorkflows(workspaceId: string, status?: WorkflowSpec['status']): WorkflowSpec[] {
    const rows = status
      ? this.db.prepare('SELECT * FROM knowledge_workflows WHERE workspaceId = ? AND status = ? ORDER BY title, id').all(workspaceId, status)
      : this.db.prepare('SELECT * FROM knowledge_workflows WHERE workspaceId = ? ORDER BY title, id').all(workspaceId);
    return rows.map(rowToWorkflow);
  }

  recordRun(input: WorkflowRunInput): WorkflowRun {
    const run: WorkflowRun = {
      id: randomUUID(),
      workflowId: input.workflowId,
      projectId: input.projectId,
      task: input.task.trim(),
      ...(input.startingSnapshotId ? { startingSnapshotId: input.startingSnapshotId } : {}),
      selectedEvidence: [...new Set(input.selectedEvidence ?? [])],
      phaseState: input.phaseState ?? {},
      outcome: input.outcome,
      verificationVerdict: input.verificationVerdict ?? (input.outcome === 'failed' ? 'failed' : 'not-run'),
      ...(input.failureReason?.trim() ? { failureReason: input.failureReason.trim() } : {}),
      startedAt: input.startedAt ?? new Date().toISOString(),
      ...(input.completedAt ? { completedAt: input.completedAt } : input.outcome !== 'in-progress' ? { completedAt: new Date().toISOString() } : {}),
    };
    this.db.prepare(
      'INSERT INTO knowledge_workflow_runs (id, workflowId, projectId, task, startingSnapshotId, selectedEvidenceJson, phaseStateJson, outcome, verificationVerdict, failureReason, startedAt, completedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      run.id,
      run.workflowId,
      run.projectId,
      run.task,
      run.startingSnapshotId ?? null,
      JSON.stringify(run.selectedEvidence),
      JSON.stringify(run.phaseState),
      run.outcome,
      run.verificationVerdict,
      run.failureReason ?? null,
      run.startedAt,
      run.completedAt ?? null,
    );
    return this.getRun(run.id)!;
  }

  getRun(id: string): WorkflowRun | undefined {
    const row = this.db.prepare('SELECT * FROM knowledge_workflow_runs WHERE id = ?').get(id);
    return row ? rowToRun(row) : undefined;
  }

  listRuns(projectId: string, workflowId?: string, limit = 20): WorkflowRun[] {
    const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 100));
    const rows = workflowId
      ? this.db.prepare('SELECT * FROM knowledge_workflow_runs WHERE projectId = ? AND workflowId = ? ORDER BY startedAt DESC LIMIT ?').all(projectId, workflowId, boundedLimit)
      : this.db.prepare('SELECT * FROM knowledge_workflow_runs WHERE projectId = ? ORDER BY startedAt DESC LIMIT ?').all(projectId, boundedLimit);
    return rows.map(rowToRun);
  }

  recentFailureCautions(projectId: string, workflowId: string, limit = 2): string[] {
    return this.listRuns(projectId, workflowId, limit)
      .filter(run => run.outcome === 'failed' || run.verificationVerdict === 'failed')
      .map(run => run.failureReason
        ? 'Previous run failed: ' + run.failureReason
        : 'Previous run has a failed verification gate.');
  }
}
