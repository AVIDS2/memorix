import { MaintenanceJobStore } from './maintenance-jobs.js';

export type MaintenanceQueue = Pick<MaintenanceJobStore, 'enqueue'>;

function queueFor(input: { dataDir: string; queue?: MaintenanceQueue }): MaintenanceQueue {
  return input.queue ?? new MaintenanceJobStore(input.dataDir);
}

/**
 * Coalesce every trigger for a project's next Code Memory scan. The newest
 * event replaces the payload while one durable job remains pending.
 */
export function enqueueCodegraphRefresh(input: {
  dataDir: string;
  projectId: string;
  source: string;
  maxFiles?: number;
  queue?: MaintenanceQueue;
}): void {
  queueFor(input).enqueue({
    projectId: input.projectId,
    kind: 'codegraph-refresh',
    dedupeKey: 'codegraph-refresh',
    payload: {
      source: input.source,
      ...(input.maxFiles ? { maxFiles: input.maxFiles } : {}),
    },
  });
}

/**
 * Requalification is owned by one job per project, never by an individual
 * snapshot. A newer refresh replaces the snapshot metadata before it runs.
 */
export function enqueueClaimRequalification(input: {
  dataDir: string;
  projectId: string;
  source: string;
  snapshotId?: string;
  queue?: MaintenanceQueue;
}): void {
  queueFor(input).enqueue({
    projectId: input.projectId,
    kind: 'claim-requalification',
    dedupeKey: 'claim-requalification',
    payload: {
      source: input.source,
      ...(input.snapshotId ? { snapshotId: input.snapshotId } : {}),
    },
  });
}

/** A stored explicit/Git observation earns a recoverable claim derivation. */
export function enqueueClaimDerivation(input: {
  dataDir: string;
  projectId: string;
  observationId: number;
  queue?: MaintenanceQueue;
}): void {
  queueFor(input).enqueue({
    projectId: input.projectId,
    kind: 'claim-derive',
    dedupeKey: 'claim-derive:' + input.observationId,
    payload: { observationId: input.observationId },
  });
}

/**
 * Automatic captures are initially only candidates. Qualification runs in the
 * durable maintenance lane after Code Memory has a chance to refresh.
 */
export function enqueueObservationQualification(input: {
  dataDir: string;
  projectId: string;
  source: string;
  queue?: MaintenanceQueue;
}): void {
  queueFor(input).enqueue({
    projectId: input.projectId,
    kind: 'observation-qualify',
    dedupeKey: 'observation-qualify',
    payload: { source: input.source, limit: 100 },
  });
}

/**
 * The follow-up jobs operate on the same workspace the Workset reads: a
 * versioned workspace when present, otherwise the local workspace.
 */
export function enqueueKnowledgeFollowups(input: {
  dataDir: string;
  projectId: string;
  source: string;
  includeCompile?: boolean;
  workspaceMode?: 'local' | 'versioned';
  allowVersionedWrite?: boolean;
  queue?: MaintenanceQueue;
}): void {
  const queue = queueFor(input);
  const payload = {
    source: input.source,
    ...(input.workspaceMode ? { workspaceMode: input.workspaceMode } : {}),
    ...(input.allowVersionedWrite ? { allowVersionedWrite: true } : {}),
  };
  if (input.includeCompile) {
    queue.enqueue({
      projectId: input.projectId,
      kind: 'knowledge-compile',
      dedupeKey: 'knowledge-compile',
      payload,
    });
  }
  queue.enqueue({
    projectId: input.projectId,
    kind: 'knowledge-lint',
    dedupeKey: 'knowledge-lint',
    payload,
  });
  queue.enqueue({
    projectId: input.projectId,
    kind: 'workflow-index',
    dedupeKey: 'workflow-index',
    payload,
  });
}
