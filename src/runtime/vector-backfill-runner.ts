import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDotenv } from '../config/dotenv-loader.js';
import { initProjectRoot } from '../config/yaml-loader.js';
import { prepareSearchIndex, initObservations } from '../memory/observations.js';
import { sanitizeCredentials } from '../memory/secret-filter.js';
import { initObservationStore } from '../store/obs-store.js';
import { getDeferredCachedVectorHydration } from '../store/orama-store.js';
import { closeAllDatabases } from '../store/sqlite-db.js';
import { MaintenanceJobStore, MaintenanceJobWorker } from './maintenance-jobs.js';
import { createProjectMaintenanceHandler } from './project-maintenance.js';

export interface VectorBackfillRequest {
  projectId: string;
  projectRoot: string;
  dataDir: string;
}

export interface VectorBackfillLauncherOptions {
  runnerPath?: string;
  exists?: (path: string) => boolean;
  spawn?: typeof spawn;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Resolve the standalone worker next to either the library or CLI bundle. */
export function resolveVectorBackfillRunnerPath(moduleUrl = import.meta.url): string {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const distDir = path.basename(moduleDir) === 'cli'
    ? path.dirname(moduleDir)
    : path.basename(moduleDir) === 'runtime' && path.basename(path.dirname(moduleDir)) === 'src'
      ? path.join(path.dirname(path.dirname(moduleDir)), 'dist')
      : moduleDir;
  return path.join(distDir, 'vector-backfill-runner.js');
}

/** Parse the internal request passed from a short-lived CLI process. */
export function parseVectorBackfillRequest(raw: string): VectorBackfillRequest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Vector backfill runner received invalid JSON input');
  }

  if (
    !value ||
    typeof value !== 'object' ||
    !isNonEmptyString((value as VectorBackfillRequest).projectId) ||
    !isNonEmptyString((value as VectorBackfillRequest).projectRoot) ||
    !isNonEmptyString((value as VectorBackfillRequest).dataDir) ||
    !path.isAbsolute((value as VectorBackfillRequest).projectRoot) ||
    !path.isAbsolute((value as VectorBackfillRequest).dataDir)
  ) {
    throw new Error('Vector backfill runner received an invalid request');
  }

  return {
    projectId: (value as VectorBackfillRequest).projectId,
    projectRoot: (value as VectorBackfillRequest).projectRoot,
    dataDir: (value as VectorBackfillRequest).dataDir,
  };
}

/**
 * Start a detached one-shot worker. The caller has already persisted the
 * observation and durable vector job, so failure to start is recoverable by a
 * later MCP or control-plane session.
 */
export function launchDetachedVectorBackfill(
  request: VectorBackfillRequest,
  options: VectorBackfillLauncherOptions = {},
): boolean {
  const runnerPath = options.runnerPath ?? resolveVectorBackfillRunnerPath();
  const exists = options.exists ?? existsSync;
  if (!exists(runnerPath)) return false;

  try {
    const child = (options.spawn ?? spawn)(process.execPath, [runnerPath], {
      cwd: request.projectRoot,
      // Windows creates a console for detached children. This worker is backed
      // by the durable queue, so unref alone is sufficient there.
      detached: process.platform !== 'win32',
      stdio: 'ignore',
      // The request contains only local project metadata, never credentials.
      // Environment transport avoids a live stdin pipe keeping the CLI alive.
      env: { ...process.env, MEMORIX_VECTOR_BACKFILL_REQUEST: JSON.stringify(request) },
      windowsHide: true,
    }) as ChildProcess;
    child.once?.('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** Run one durable vector-backfill job without sharing the CLI event loop. */
export async function executeVectorBackfill(request: VectorBackfillRequest) {
  initProjectRoot(request.projectRoot);
  loadDotenv(request.projectRoot);
  await initObservationStore(request.dataDir);
  await initObservations(request.dataDir);
  await prepareSearchIndex();
  await getDeferredCachedVectorHydration()?.catch(() => {});

  const worker = new MaintenanceJobWorker(
    new MaintenanceJobStore(request.dataDir),
    createProjectMaintenanceHandler(request.projectId, request.dataDir, request.projectRoot),
    { projectId: request.projectId, kinds: ['vector-backfill'] },
  );
  return worker.runOnce();
}

async function readStdin(): Promise<string> {
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
    const raw = process.env.MEMORIX_VECTOR_BACKFILL_REQUEST ?? await readStdin();
    await executeVectorBackfill(parseVectorBackfillRequest(raw));
  } catch (error) {
    const detail = sanitizeCredentials(error instanceof Error ? error.message : String(error));
    process.stderr.write(`[memorix] vector backfill worker failed: ${detail}\n`);
    process.exitCode = 1;
  } finally {
    closeAllDatabases();
  }
}

if (process.argv[1] && process.argv[1].endsWith('vector-backfill-runner.js')) {
  void main();
}
