import {
  MaintenanceJobStore,
  MaintenanceJobWorker,
  type MaintenanceJobHandler,
  type MaintenanceJobKind,
} from './maintenance-jobs.js';
import { runMaintenanceInChildProcess } from './isolated-maintenance.js';
import { MaintenanceTargetStore } from './maintenance-targets.js';

export const CONTROL_PLANE_MAINTENANCE_KINDS: readonly MaintenanceJobKind[] = [
  'retention-archive',
  'consolidation',
  'codegraph-refresh',
  'observation-qualify',
  'claim-derive',
  'claim-requalification',
  'knowledge-compile',
  'knowledge-lint',
  'workflow-index',
];

const TARGET_WAIT_RETRY_MS = 30_000;

/**
 * Resolve a durable job to an isolated runner without sharing a session's
 * global config, observation cache, or Orama index with another HTTP client.
 */
export function createControlPlaneMaintenanceHandler(
  dataDir: string,
  isolatedRunner: typeof runMaintenanceInChildProcess = runMaintenanceInChildProcess,
): MaintenanceJobHandler {
  const targets = new MaintenanceTargetStore(dataDir);
  return async (job) => {
    if (!CONTROL_PLANE_MAINTENANCE_KINDS.includes(job.kind)) {
      throw new Error(`Control-plane worker cannot process ${job.kind}`);
    }
    const target = targets.get(job.projectId);
    if (!target) {
      return { action: 'reschedule', delayMs: TARGET_WAIT_RETRY_MS };
    }
    return isolatedRunner({
      job,
      projectRoot: target.projectRoot,
      dataDir: target.dataDir,
    });
  };
}

export function createControlPlaneMaintenanceWorker(
  dataDir: string,
  options: {
    workerId?: string;
    pollIntervalMs?: number;
    leaseMs?: number;
    isolatedRunner?: typeof runMaintenanceInChildProcess;
  } = {},
): MaintenanceJobWorker {
  return new MaintenanceJobWorker(
    new MaintenanceJobStore(dataDir),
    createControlPlaneMaintenanceHandler(dataDir, options.isolatedRunner),
    {
      workerId: options.workerId,
      pollIntervalMs: options.pollIntervalMs,
      leaseMs: options.leaseMs,
      kinds: CONTROL_PLANE_MAINTENANCE_KINDS,
    },
  );
}
