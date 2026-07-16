import { closeAllDatabases } from '../store/sqlite-db.js';
import { loadDotenv } from '../config/dotenv-loader.js';
import { initProjectRoot } from '../config/yaml-loader.js';
import { initLLM } from '../llm/provider.js';
import { initObservationStore } from '../store/obs-store.js';
import {
  MAINTENANCE_JOB_KINDS,
  type MaintenanceJob,
  type MaintenanceJobRunResult,
} from './maintenance-jobs.js';
import {
  ISOLATED_MAINTENANCE_JOB_KINDS,
  MAINTENANCE_RESULT_PREFIX,
  type IsolatedMaintenanceRequest,
} from './isolated-maintenance.js';
import { createProjectMaintenanceHandler } from './project-maintenance.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isJob(value: unknown): value is MaintenanceJob {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.projectId === 'string'
    && typeof value.kind === 'string'
    && MAINTENANCE_JOB_KINDS.includes(value.kind as MaintenanceJob['kind'])
    && ISOLATED_MAINTENANCE_JOB_KINDS.includes(value.kind as MaintenanceJob['kind'])
    && isRecord(value.payload);
}

export function parseMaintenanceRequest(raw: string): IsolatedMaintenanceRequest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Maintenance runner received invalid JSON input');
  }
  if (!isRecord(value) || !isJob(value.job)) {
    throw new Error('Maintenance runner received an invalid job payload');
  }
  if (typeof value.projectRoot !== 'string' || !value.projectRoot) {
    throw new Error('Maintenance runner requires projectRoot');
  }
  if (typeof value.dataDir !== 'string' || !value.dataDir) {
    throw new Error('Maintenance runner requires dataDir');
  }
  return {
    job: value.job,
    projectRoot: value.projectRoot,
    dataDir: value.dataDir,
  };
}

export async function executeMaintenanceRequest(
  request: IsolatedMaintenanceRequest,
): Promise<MaintenanceJobRunResult> {
  initProjectRoot(request.projectRoot);
  loadDotenv(request.projectRoot);
  await initObservationStore(request.dataDir);
  if (request.job.kind === 'consolidation') initLLM();

  const handler = createProjectMaintenanceHandler(
    request.job.projectId,
    request.dataDir,
    request.projectRoot,
  );
  return (await handler(request.job)) ?? { action: 'complete' };
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { raw += chunk; });
    process.stdin.once('error', reject);
    process.stdin.once('end', () => resolve(raw));
  });
}

export async function main(): Promise<void> {
  try {
    const request = parseMaintenanceRequest(await readStdin());
    const result = await executeMaintenanceRequest(request);
    process.stdout.write(`${MAINTENANCE_RESULT_PREFIX}${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`[memorix] maintenance runner failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    closeAllDatabases();
  }
}

if (process.argv[1] && process.argv[1].endsWith('maintenance-runner.js')) {
  void main();
}
