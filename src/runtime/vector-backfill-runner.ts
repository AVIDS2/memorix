import { spawn, type ChildProcess } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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
import { MaintenanceTargetStore, type MaintenanceTarget } from './maintenance-targets.js';
import { createProjectMaintenanceHandler } from './project-maintenance.js';

const VECTOR_BACKFILL_LOCK_FILE = '.memorix-vector-backfill.lock';
const STALE_LOCK_RECOVERY_MS = 24 * 60 * 60 * 1_000;

export interface VectorBackfillRequest {
  projectId: string;
  projectRoot: string;
  dataDir: string;
}

export interface VectorBackfillLauncherOptions {
  runnerPath?: string;
  exists?: (path: string) => boolean;
  spawn?: typeof spawn;
  lockPath?: string;
}

interface VectorBackfillLock {
  parentPid: number;
  childPid?: number;
  startedAt: number;
  projectId: string;
}

interface VectorBackfillLockHandle {
  path: string;
  setChildPid(pid: number): void;
  release(): void;
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

export function vectorBackfillLockPath(dataDir: string): string {
  return path.join(dataDir, VECTOR_BACKFILL_LOCK_FILE);
}

function processIsAlive(pid: number | undefined): boolean {
  if (!Number.isSafeInteger(pid) || pid == null || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but this process cannot signal it.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readVectorBackfillLock(lockPath: string): VectorBackfillLock | undefined {
  try {
    const value = JSON.parse(readFileSync(lockPath, 'utf8')) as Partial<VectorBackfillLock>;
    if (
      typeof value.parentPid !== 'number'
      || !Number.isSafeInteger(value.parentPid)
      || typeof value.startedAt !== 'number'
      || !Number.isFinite(value.startedAt)
      || typeof value.projectId !== 'string'
    ) return undefined;
    return {
      parentPid: value.parentPid,
      ...(typeof value.childPid === 'number' ? { childPid: value.childPid } : {}),
      startedAt: value.startedAt,
      projectId: value.projectId,
    };
  } catch {
    return undefined;
  }
}

function writeVectorBackfillLock(lockPath: string, value: VectorBackfillLock): void {
  writeFileSync(lockPath, `${JSON.stringify(value)}\n`, 'utf8');
}

function acquireVectorBackfillLock(
  dataDir: string,
  projectId: string,
  preferredPath?: string,
): VectorBackfillLockHandle | undefined {
  const lockPath = preferredPath ?? vectorBackfillLockPath(dataDir);
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const initial: VectorBackfillLock = {
    parentPid: process.pid,
    startedAt: Date.now(),
    projectId,
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx');
      try {
        writeFileSync(fd, `${JSON.stringify(initial)}\n`, 'utf8');
      } finally {
        closeSync(fd);
      }
      return {
        path: lockPath,
        setChildPid(pid: number) {
          try {
            writeVectorBackfillLock(lockPath, { ...initial, childPid: pid });
          } catch {
            // The child can still release the lock on normal shutdown; a dead
            // owner is recoverable on the next launch.
          }
        },
        release() {
          try { unlinkSync(lockPath); } catch { /* already released */ }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return undefined;
      const existing = readVectorBackfillLock(lockPath);
      const ownerAlive = existing && (processIsAlive(existing.childPid) || processIsAlive(existing.parentPid));
      if (ownerAlive) return undefined;

      // A malformed lock is not deleted immediately: another process may be
      // between create and write. A dead, well-formed owner is safe to reap;
      // an unreadable lock needs a long recovery window so it cannot cause a
      // second heavy worker during a slow filesystem operation.
      let stale = false;
      try {
        stale = Date.now() - statSync(lockPath).mtimeMs >= STALE_LOCK_RECOVERY_MS;
      } catch {
        stale = false;
      }
      if (!existing && !stale) return undefined;
      try { unlinkSync(lockPath); } catch { return undefined; }
    }
  }
  return undefined;
}

export function releaseVectorBackfillLock(lockPath = process.env.MEMORIX_VECTOR_BACKFILL_LOCK): void {
  if (!lockPath) return;
  const lock = readVectorBackfillLock(lockPath);
  if (lock && lock.childPid !== process.pid) return;
  try { unlinkSync(lockPath); } catch { /* already released */ }
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

  const lock = acquireVectorBackfillLock(request.dataDir, request.projectId, options.lockPath);
  if (!lock) return false;

  try {
    const child = (options.spawn ?? spawn)(process.execPath, [runnerPath], {
      cwd: request.projectRoot,
      // Windows creates a console for detached children. This worker is backed
      // by the durable queue, so unref alone is sufficient there.
      detached: process.platform !== 'win32',
      stdio: 'ignore',
      // The request contains only local project metadata, never credentials.
      // Environment transport avoids a live stdin pipe keeping the CLI alive.
      env: {
        ...process.env,
        MEMORIX_VECTOR_BACKFILL_REQUEST: JSON.stringify(request),
        MEMORIX_VECTOR_BACKFILL_LOCK: lock.path,
      },
      windowsHide: true,
    }) as ChildProcess;
    if (child.pid) lock.setChildPid(child.pid);
    else lock.release();
    child.once?.('error', () => {});
    child.once?.('close', () => lock.release());
    // Test doubles and unusual spawn adapters may not expose ChildProcess
    // events. Do not leave a lock behind when there is no lifecycle to own it.
    if (typeof child.once !== 'function') lock.release();
    child.unref();
    return Boolean(child.pid);
  } catch {
    lock.release();
    return false;
  }
}

/** Run one durable vector-backfill job without sharing the CLI event loop. */
export async function executeVectorBackfill(request: VectorBackfillRequest) {
  initProjectRoot(request.projectRoot);
  loadDotenv(request.projectRoot);
  await initObservationStore(request.dataDir);
  await initObservations(request.dataDir, { forceCorpusLoad: true });
  await prepareSearchIndex();
  await getDeferredCachedVectorHydration()?.catch(() => {});

  const queue = new MaintenanceJobStore(request.dataDir);
  const targets = new MaintenanceTargetStore(request.dataDir);
  let preparedRoot = request.projectRoot;
  const prepareTarget = async (target: MaintenanceTarget): Promise<void> => {
    if (target.projectRoot === preparedRoot) return;
    initProjectRoot(target.projectRoot);
    loadDotenv(target.projectRoot);
    preparedRoot = target.projectRoot;
    // The data directory is shared across projects. The in-process index is
    // intentionally global, so switching the target only changes the config
    // and the job scope; it does not create another corpus/index copy.
  };

  const handler = async (job: Parameters<ReturnType<typeof createProjectMaintenanceHandler>>[0]) => {
    const target = targets.get(job.projectId)
      ?? (job.projectId === request.projectId
        ? { projectId: request.projectId, projectRoot: request.projectRoot, dataDir: request.dataDir, updatedAt: Date.now() }
        : undefined);
    if (!target) return { action: 'reschedule' as const, delayMs: 30_000 };
    await prepareTarget(target);
    return createProjectMaintenanceHandler(job.projectId, target.dataDir, target.projectRoot)(job);
  };

  const worker = new MaintenanceJobWorker(
    queue,
    handler,
    { kinds: ['vector-backfill'] },
  );
  // Drain currently due vector jobs while this one process owns the lock. A
  // hook storm therefore creates at most one heavy process, and pending jobs
  // for other projects are picked up without requiring another hook event.
  let result: Awaited<ReturnType<typeof worker.runOnce>> = { state: 'idle' };
  while (true) {
    result = await worker.runOnce();
    if (result.state === 'idle') break;
  }
  return result;
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
    releaseVectorBackfillLock();
    closeAllDatabases();
  }
}

if (process.argv[1] && process.argv[1].endsWith('vector-backfill-runner.js')) {
  void main();
}
