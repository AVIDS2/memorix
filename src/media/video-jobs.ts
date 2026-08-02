import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sanitizeCredentials } from '../memory/secret-filter.js';
import {
  MaintenanceJobStore,
  type MaintenanceJob,
  type MaintenanceJobRunResult,
} from '../runtime/maintenance-jobs.js';
import { attachMediaAssetToObservation } from './attachment.js';
import { importMediaBuffer } from './asset-store.js';
import {
  createMiniMaxVideoTask,
  normalizeMiniMaxVideoRequest,
  queryMiniMaxVideoTask,
  type MiniMaxVideoGenerationRequest,
  type MiniMaxVideoTask,
  type MiniMaxVideoTransport,
} from './minimax.js';
import { MediaStore } from './media-store.js';
import { downloadProviderMedia } from './remote-download.js';
import type { MediaAsset, MediaJob } from './types.js';

export const MEDIA_VIDEO_MAINTENANCE_KIND = 'media-video-generation' as const;
export const MINI_MAX_VIDEO_POLL_MS = 10_000;
const MAX_MEDIA_VIDEO_ATTEMPTS = 4;

interface StoredMiniMaxVideoRequest {
  provider: 'minimax' | 'minimax-cn';
  region: 'global' | 'cn';
  model: 'MiniMax-H3';
  prompt: string;
  resolution: '2K';
  duration: 5 | 10;
  ratio: 'adaptive' | '16:9' | '9:16' | '1:1';
  maxBytes: number;
}

export interface QueueMiniMaxVideoInput extends Omit<MiniMaxVideoGenerationRequest, 'apiKey' | 'baseUrl'> {
  dataDir: string;
  projectId: string;
  maxBytes?: number;
  attachOnComplete?: boolean;
  observationTitle?: string;
}

export interface QueuedMiniMaxVideo {
  mediaJob: MediaJob;
  maintenanceJob: MaintenanceJob;
}

export interface MediaVideoGenerationDependencies {
  createTask?: typeof createMiniMaxVideoTask;
  queryTask?: typeof queryMiniMaxVideoTask;
  download?: (input: { url: string; maxBytes: number }) => Promise<Buffer>;
  attach?: typeof attachMediaAssetToObservation;
}

export interface MediaVideoRunnerRequest {
  projectId: string;
  projectRoot: string;
  dataDir: string;
  mediaJobId: string;
}

function safeError(error: unknown): string {
  return sanitizeCredentials(error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

function requireConfiguredApiKey(region: 'global' | 'cn'): void {
  const value = region === 'cn' ? process.env.MINIMAX_CN_API_KEY : process.env.MINIMAX_API_KEY;
  if (!value?.trim()) throw new Error(region === 'cn' ? 'MINIMAX_CN_API_KEY is required' : 'MINIMAX_API_KEY is required');
}

function parseMaxBytes(value: number | undefined): number {
  const maxBytes = value ?? 100 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Video output maxBytes must be a positive integer');
  return maxBytes;
}

function parseStoredRequest(value: Record<string, unknown>): StoredMiniMaxVideoRequest {
  const provider = value.provider;
  const region = value.region;
  const model = value.model;
  const prompt = value.prompt;
  const resolution = value.resolution;
  const duration = value.duration;
  const ratio = value.ratio;
  const maxBytes = value.maxBytes;
  if ((provider !== 'minimax' && provider !== 'minimax-cn')
    || (region !== 'global' && region !== 'cn')
    || model !== 'MiniMax-H3'
    || typeof prompt !== 'string'
    || resolution !== '2K'
    || (duration !== 5 && duration !== 10)
    || (ratio !== 'adaptive' && ratio !== '16:9' && ratio !== '9:16' && ratio !== '1:1')
    || typeof maxBytes !== 'number' || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('Media video job has an invalid request payload');
  }
  return { provider, region, model, prompt, resolution, duration, ratio, maxBytes };
}

function mediaJobIdFromMaintenance(job: MaintenanceJob): string {
  const mediaJobId = job.payload.mediaJobId;
  if (typeof mediaJobId !== 'string' || !mediaJobId.trim()) {
    throw new Error('Media video maintenance job is missing mediaJobId');
  }
  return mediaJobId;
}

function toVideoRequest(request: StoredMiniMaxVideoRequest): MiniMaxVideoGenerationRequest {
  return {
    prompt: request.prompt,
    model: request.model,
    region: request.region,
    resolution: request.resolution,
    duration: request.duration,
    ratio: request.ratio,
  };
}

function terminal(job: MediaJob): boolean {
  return job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
}

function sourceLabel(request: StoredMiniMaxVideoRequest, providerTaskId: string): string {
  return `minimax-${request.model}-${providerTaskId}`;
}

async function finishWithAsset(input: {
  dataDir: string;
  projectId: string;
  store: MediaStore;
  mediaJob: MediaJob;
  request: StoredMiniMaxVideoRequest;
  providerTask: MiniMaxVideoTask;
  dependencies: MediaVideoGenerationDependencies;
}): Promise<MaintenanceJobRunResult> {
  const { dataDir, projectId, store, mediaJob, request, providerTask, dependencies } = input;
  let activeJob = store.getJob(projectId, mediaJob.id);
  if (!activeJob || terminal(activeJob)) return { action: 'complete' };
  let asset: MediaAsset | undefined = activeJob.assetId
    ? store.getAsset(projectId, activeJob.assetId)
    : undefined;
  if (!asset) {
    if (!providerTask.downloadUrl) throw new Error('Succeeded MiniMax video task did not include a download URL');
    const downloading = store.updateJobIfNotCancelled(projectId, activeJob.id, {
      status: 'downloading',
      providerTaskId: providerTask.taskId,
    });
    if (!downloading) return { action: 'complete' };
    activeJob = downloading;
    const bytes = await (dependencies.download ?? ((downloadInput) => downloadProviderMedia(downloadInput)))({
      url: providerTask.downloadUrl,
      maxBytes: request.maxBytes,
    });
    const imported = await importMediaBuffer({
      dataDir,
      projectId,
      bytes,
      filename: sourceLabel(request, providerTask.taskId),
      sourceKind: 'minimax-video',
      sourceLabel: sourceLabel(request, providerTask.taskId),
      provider: request.provider,
      model: request.model,
      maxBytes: request.maxBytes,
    });
    asset = imported.asset;
    // Persist the local result before optional attachment. A later retry can
    // resume attachment even if the provider's signed URL has expired.
    const persistedAsset = store.updateJobIfNotCancelled(projectId, activeJob.id, {
      status: 'downloading',
      providerTaskId: providerTask.taskId,
      assetId: asset.id,
    });
    if (!persistedAsset) return { action: 'complete' };
    activeJob = persistedAsset;
  }

  if (activeJob.attachOnComplete) {
    activeJob = store.getJob(projectId, activeJob.id);
    if (!activeJob || terminal(activeJob)) return { action: 'complete' };
    const hasAttachment = store.listLinks(projectId, asset.id)
      .some((link) => link.role === 'attachment' && link.observationId !== undefined);
    if (!hasAttachment) {
      await (dependencies.attach ?? attachMediaAssetToObservation)({
        dataDir,
        projectId,
        asset,
        title: activeJob.observationTitle ?? `MiniMax video: ${asset.sourceLabel ?? asset.id}`,
        narrative: `Generated with ${request.provider}/${request.model}. Prompt: ${request.prompt}`,
        concepts: ['generated-video', 'minimax', request.model],
      });
    }
  }
  store.updateJobIfNotCancelled(projectId, activeJob.id, {
    status: 'completed',
    providerTaskId: providerTask.taskId,
    assetId: asset.id,
  });
  return { action: 'complete' };
}

function retryAfterProviderError(
  store: MediaStore,
  projectId: string,
  mediaJob: MediaJob,
  maintenanceJob: MaintenanceJob,
  error: unknown,
): MaintenanceJobRunResult {
  const message = safeError(error);
  if (maintenanceJob.attempts >= maintenanceJob.maxAttempts) {
    store.updateJobIfNotCancelled(projectId, mediaJob.id, { status: 'failed', lastError: message, incrementAttempts: true });
    return { action: 'complete' };
  }
  if (!store.updateJobIfNotCancelled(projectId, mediaJob.id, { status: 'retry', lastError: message, incrementAttempts: true })) {
    return { action: 'complete' };
  }
  return { action: 'reschedule', delayMs: MINI_MAX_VIDEO_POLL_MS, status: 'retry', lastError: message };
}

/**
 * Creates a durable user-facing media job plus a leased maintenance job. The
 * payload deliberately excludes provider credentials and temporary URLs.
 */
export function queueMiniMaxVideoGeneration(input: QueueMiniMaxVideoInput): QueuedMiniMaxVideo {
  const normalized = normalizeMiniMaxVideoRequest(input);
  requireConfiguredApiKey(normalized.region);
  const request: StoredMiniMaxVideoRequest = {
    provider: normalized.region === 'cn' ? 'minimax-cn' : 'minimax',
    region: normalized.region,
    model: normalized.model,
    prompt: normalized.prompt,
    resolution: normalized.resolution,
    duration: normalized.duration,
    ratio: normalized.ratio,
    maxBytes: parseMaxBytes(input.maxBytes),
  };
  const store = new MediaStore(input.dataDir);
  const mediaJob = store.createJob({
    projectId: input.projectId,
    kind: 'minimax-video-generation',
    request: { ...request },
    attachOnComplete: input.attachOnComplete,
    observationTitle: input.observationTitle,
  });
  const maintenanceJob = new MaintenanceJobStore(input.dataDir).enqueue({
    projectId: input.projectId,
    kind: MEDIA_VIDEO_MAINTENANCE_KIND,
    dedupeKey: `media-video:${mediaJob.id}`,
    payload: { mediaJobId: mediaJob.id },
    maxAttempts: MAX_MEDIA_VIDEO_ATTEMPTS,
  });
  return { mediaJob, maintenanceJob };
}

/** Handles one durable video job; all query/download retry decisions are explicit here. */
export async function runMiniMaxVideoGenerationJob(
  maintenanceJob: MaintenanceJob,
  context: { dataDir: string; projectId: string },
  dependencies: MediaVideoGenerationDependencies = {},
): Promise<MaintenanceJobRunResult> {
  const mediaJobId = mediaJobIdFromMaintenance(maintenanceJob);
  const store = new MediaStore(context.dataDir);
  const mediaJob = store.getJob(context.projectId, mediaJobId);
  if (!mediaJob || terminal(mediaJob)) return { action: 'complete' };
  if (mediaJob.kind !== 'minimax-video-generation') throw new Error(`Unsupported media job kind: ${mediaJob.kind}`);
  const request = parseStoredRequest(mediaJob.request);

  if (!mediaJob.providerTaskId) {
    if (!store.updateJobIfNotCancelled(context.projectId, mediaJob.id, { status: 'submitting', incrementAttempts: true })) {
      return { action: 'complete' };
    }
    let submitted: MiniMaxVideoTask;
    try {
      submitted = await (dependencies.createTask ?? createMiniMaxVideoTask)(toVideoRequest(request));
    } catch (error) {
      // A submit timeout can mean the provider accepted a billable request. Do
      // not retry automatically without a task ID; the operator can resubmit.
      store.updateJobIfNotCancelled(context.projectId, mediaJob.id, { status: 'failed', lastError: safeError(error) });
      return { action: 'complete' };
    }
    if (submitted.status === 'failed') {
      store.updateJobIfNotCancelled(context.projectId, mediaJob.id, { status: 'failed', providerTaskId: submitted.taskId, lastError: submitted.error });
      return { action: 'complete' };
    }
    const pending = store.updateJobIfNotCancelled(context.projectId, mediaJob.id, {
      status: submitted.status === 'succeeded' ? 'downloading' : 'provider-pending',
      providerTaskId: submitted.taskId,
    });
    if (!pending) return { action: 'complete' };
    if (submitted.status === 'succeeded') {
      try {
        return await finishWithAsset({
          dataDir: context.dataDir,
          projectId: context.projectId,
          store,
          mediaJob: pending,
          request,
          providerTask: submitted,
          dependencies,
        });
      } catch (error) {
        return retryAfterProviderError(store, context.projectId, pending, maintenanceJob, error);
      }
    }
    return { action: 'reschedule', delayMs: MINI_MAX_VIDEO_POLL_MS, resetAttempts: true, clearLastError: true };
  }

  let task: MiniMaxVideoTask;
  try {
    task = await (dependencies.queryTask ?? queryMiniMaxVideoTask)({
      ...toVideoRequest(request),
      taskId: mediaJob.providerTaskId,
    });
  } catch (error) {
    return retryAfterProviderError(store, context.projectId, mediaJob, maintenanceJob, error);
  }
  if (task.status === 'pending') {
    if (!store.updateJobIfNotCancelled(context.projectId, mediaJob.id, { status: 'provider-pending', providerTaskId: task.taskId })) {
      return { action: 'complete' };
    }
    return { action: 'reschedule', delayMs: MINI_MAX_VIDEO_POLL_MS, resetAttempts: true, clearLastError: true };
  }
  if (task.status === 'failed') {
    store.updateJobIfNotCancelled(context.projectId, mediaJob.id, { status: 'failed', providerTaskId: task.taskId, lastError: task.error, incrementAttempts: true });
    return { action: 'complete' };
  }
  try {
    return await finishWithAsset({
      dataDir: context.dataDir,
      projectId: context.projectId,
      store,
      mediaJob,
      request,
      providerTask: task,
      dependencies,
    });
  } catch (error) {
    return retryAfterProviderError(store, context.projectId, mediaJob, maintenanceJob, error);
  }
}

export function resolveMediaVideoRunnerPath(moduleUrl = import.meta.url): string {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const parentDir = path.dirname(moduleDir);
  const distDir = path.basename(moduleDir) === 'cli'
    ? parentDir
    : path.basename(moduleDir) === 'media' && path.basename(parentDir) === 'src'
      ? path.join(path.dirname(parentDir), 'dist')
      : moduleDir;
  return path.join(distDir, 'media-video-runner.js');
}

/**
 * Kick a short-lived local worker for CLI-only users. It has no terminal
 * window on Windows and intentionally does not use detached CreateProcess.
 */
export function launchMediaVideoRunner(
  request: MediaVideoRunnerRequest,
  options: { runnerPath?: string } = {},
): { launched: boolean; reason?: string } {
  const runnerPath = options.runnerPath ?? resolveMediaVideoRunnerPath();
  if (!existsSync(runnerPath)) {
    return { launched: false, reason: 'Media video runner is unavailable until Memorix is built or reinstalled.' };
  }
  try {
    const child = spawn(process.execPath, [runnerPath, JSON.stringify(request)], {
      cwd: request.projectRoot,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return { launched: true };
  } catch (error) {
    return { launched: false, reason: safeError(error) };
  }
}
