import path from 'node:path';

import { loadDotenv } from '../config/dotenv-loader.js';
import { initProjectRoot } from '../config/yaml-loader.js';
import { MediaStore } from '../media/media-store.js';
import { MEDIA_AUDIO_MAINTENANCE_KIND, type MediaAudioRunnerRequest } from '../media/audio-jobs.js';
import { initObservations } from '../memory/observations.js';
import { closeAllDatabases } from '../store/sqlite-db.js';
import { MaintenanceJobStore, MaintenanceJobWorker } from './maintenance-jobs.js';
import { createProjectMaintenanceHandler } from './project-maintenance.js';

const POLL_DELAY_MS = 1_000;
const MAX_RUNNER_LIFETIME_MS = 10 * 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function terminal(status: string): status is 'completed' | 'failed' | 'cancelled' {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseMediaAudioRunnerRequest(raw: string): MediaAudioRunnerRequest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Media audio runner received invalid JSON input');
  }
  if (!isRecord(value)
    || typeof value.projectId !== 'string' || !value.projectId
    || typeof value.projectRoot !== 'string' || !path.isAbsolute(value.projectRoot)
    || typeof value.dataDir !== 'string' || !path.isAbsolute(value.dataDir)
    || typeof value.mediaJobId !== 'string' || !value.mediaJobId) {
    throw new Error('Media audio runner received an invalid request');
  }
  return {
    projectId: value.projectId,
    projectRoot: value.projectRoot,
    dataDir: value.dataDir,
    mediaJobId: value.mediaJobId,
  };
}

/** A bounded CLI nudge; durable work remains resumable from the queue. */
export async function executeMediaAudioRunner(
  request: MediaAudioRunnerRequest,
  options: { maxLifetimeMs?: number; pollDelayMs?: number } = {},
): Promise<'completed' | 'failed' | 'cancelled' | 'missing' | 'timed-out'> {
  initProjectRoot(request.projectRoot);
  loadDotenv(request.projectRoot);
  await initObservations(request.dataDir, { embeddingWriteMode: 'deferred', projectRoot: request.projectRoot });
  const mediaStore = new MediaStore(request.dataDir);
  const queue = new MaintenanceJobStore(request.dataDir);
  const worker = new MaintenanceJobWorker(
    queue,
    createProjectMaintenanceHandler(request.projectId, request.dataDir, request.projectRoot),
    { projectId: request.projectId, kinds: [MEDIA_AUDIO_MAINTENANCE_KIND], pollIntervalMs: POLL_DELAY_MS },
  );
  const maxLifetimeMs = Number.isSafeInteger(options.maxLifetimeMs)
    ? Math.max(POLL_DELAY_MS, options.maxLifetimeMs!)
    : MAX_RUNNER_LIFETIME_MS;
  const pollDelayMs = Number.isSafeInteger(options.pollDelayMs)
    ? Math.max(25, options.pollDelayMs!)
    : POLL_DELAY_MS;
  const deadline = Date.now() + maxLifetimeMs;
  while (Date.now() < deadline) {
    const before = mediaStore.getJob(request.projectId, request.mediaJobId);
    if (!before) return 'missing';
    if (terminal(before.status)) return before.status;
    await worker.runOnce();
    const after = mediaStore.getJob(request.projectId, request.mediaJobId);
    if (!after) return 'missing';
    if (terminal(after.status)) return after.status;
    await sleep(pollDelayMs);
  }
  return 'timed-out';
}

export async function main(): Promise<void> {
  try {
    const raw = process.argv[2];
    if (!raw) throw new Error('Media audio runner requires a request payload');
    await executeMediaAudioRunner(parseMediaAudioRunnerRequest(raw));
  } catch (error) {
    process.stderr.write(`[memorix] media audio runner failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    closeAllDatabases();
  }
}

if (process.argv[1] && process.argv[1].endsWith('media-audio-runner.js')) {
  void main();
}
