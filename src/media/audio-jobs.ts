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
import { readMediaAsset } from './asset-store.js';
import { MediaStore } from './media-store.js';
import type { MediaAsset, MediaDerivation, MediaJob } from './types.js';

export const MEDIA_AUDIO_MAINTENANCE_KIND = 'media-audio-transcription' as const;
export const DEFAULT_TRANSCRIPTION_MAX_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_TRANSCRIPTION_ATTEMPTS = 3;

export type AudioTranscriptionProvider = 'openai' | 'groq';

interface StoredAudioRequest {
  provider: AudioTranscriptionProvider;
  model: string;
  language?: string;
  prompt?: string;
  maxBytes: number;
}

interface TranscriptionUsage {
  seconds?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AudioTranscriptionResponse {
  text: string;
  durationSeconds?: number;
  usage?: TranscriptionUsage;
}

export interface QueueAudioTranscriptionInput {
  dataDir: string;
  projectId: string;
  assetId: string;
  provider?: AudioTranscriptionProvider;
  model?: string;
  language?: string;
  prompt?: string;
  maxBytes?: number;
  attachOnComplete?: boolean;
  observationTitle?: string;
}

export interface QueuedAudioTranscription {
  mediaJob: MediaJob;
  maintenanceJob: MaintenanceJob;
}

export interface AudioTranscriptionDependencies {
  transcribe?: (input: {
    provider: AudioTranscriptionProvider;
    model: string;
    language?: string;
    prompt?: string;
    asset: MediaAsset;
    bytes: Buffer;
  }) => Promise<AudioTranscriptionResponse>;
  attach?: typeof attachMediaAssetToObservation;
}

export interface MediaAudioRunnerRequest {
  projectId: string;
  projectRoot: string;
  dataDir: string;
  mediaJobId: string;
}

class RetryableAudioProviderError extends Error {}

function safeError(error: unknown): string {
  return sanitizeCredentials(error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

function parseProvider(value: unknown): AudioTranscriptionProvider {
  if (value === 'openai' || value === 'groq') return value;
  throw new Error('Transcription provider must be openai or groq');
}

function parseMaxBytes(value: number | undefined): number {
  const maxBytes = value ?? DEFAULT_TRANSCRIPTION_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_TRANSCRIPTION_MAX_BYTES) {
    throw new Error(`Audio transcription maxBytes must be between 1 and ${DEFAULT_TRANSCRIPTION_MAX_BYTES}`);
  }
  return maxBytes;
}

function trimOptional(value: string | undefined, label: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maximum) throw new Error(`${label} is too long (limit ${maximum} characters)`);
  return normalized;
}

function defaultModel(provider: AudioTranscriptionProvider): string {
  return provider === 'groq' ? 'whisper-large-v3-turbo' : 'gpt-4o-transcribe';
}

function providerConfig(provider: AudioTranscriptionProvider): { apiKey: string; endpoint: string } {
  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error('OPENAI_API_KEY is required for transcription provider openai');
    return { apiKey, endpoint: 'https://api.openai.com/v1/audio/transcriptions' };
  }
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error('GROQ_API_KEY is required for transcription provider groq');
  return { apiKey, endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions' };
}

function parseStoredRequest(value: Record<string, unknown>): StoredAudioRequest {
  const provider = parseProvider(value.provider);
  const model = typeof value.model === 'string' && value.model.trim();
  const language = typeof value.language === 'string' ? value.language.trim() || undefined : undefined;
  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() || undefined : undefined;
  const maxBytes = value.maxBytes;
  if (!model || typeof maxBytes !== 'number' || !Number.isSafeInteger(maxBytes)
    || maxBytes < 1 || maxBytes > DEFAULT_TRANSCRIPTION_MAX_BYTES) {
    throw new Error('Audio transcription job has an invalid request payload');
  }
  return { provider, model, ...(language ? { language } : {}), ...(prompt ? { prompt } : {}), maxBytes };
}

function mediaJobIdFromMaintenance(job: MaintenanceJob): string {
  const mediaJobId = job.payload.mediaJobId;
  if (typeof mediaJobId !== 'string' || !mediaJobId.trim()) {
    throw new Error('Audio transcription maintenance job is missing mediaJobId');
  }
  return mediaJobId;
}

function terminal(job: MediaJob): boolean {
  return job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
}

function sourceFilename(asset: MediaAsset): string {
  const label = asset.sourceLabel?.replace(/[^A-Za-z0-9._-]/g, '_') || `${asset.id}.audio`;
  return label.includes('.') ? label : `${label}.audio`;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseProviderResponse(payload: unknown): AudioTranscriptionResponse {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Transcription provider returned an invalid response');
  const record = payload as Record<string, unknown>;
  const text = typeof record.text === 'string' ? record.text.trim() : '';
  if (!text) throw new Error('Transcription provider returned no transcript text');
  const usageRecord = record.usage && typeof record.usage === 'object' && !Array.isArray(record.usage)
    ? record.usage as Record<string, unknown>
    : undefined;
  const inputTokenDetails = usageRecord?.input_token_details && typeof usageRecord.input_token_details === 'object'
    ? usageRecord.input_token_details as Record<string, unknown>
    : undefined;
  return {
    text,
    ...(asFiniteNumber(record.duration) !== undefined ? { durationSeconds: asFiniteNumber(record.duration) } : {}),
    ...(usageRecord ? {
      usage: {
        ...(asFiniteNumber(usageRecord.seconds) !== undefined ? { seconds: asFiniteNumber(usageRecord.seconds) } : {}),
        ...(asFiniteNumber(inputTokenDetails?.audio_tokens) !== undefined ? { inputTokens: asFiniteNumber(inputTokenDetails?.audio_tokens) } : {}),
        ...(asFiniteNumber(usageRecord.output_tokens) !== undefined ? { outputTokens: asFiniteNumber(usageRecord.output_tokens) } : {}),
        ...(asFiniteNumber(usageRecord.total_tokens) !== undefined ? { totalTokens: asFiniteNumber(usageRecord.total_tokens) } : {}),
      },
    } : {}),
  };
}

/** Execute only the documented OpenAI-compatible multipart contract. */
export async function transcribeAudio(input: {
  provider: AudioTranscriptionProvider;
  model: string;
  language?: string;
  prompt?: string;
  asset: MediaAsset;
  bytes: Buffer;
}): Promise<AudioTranscriptionResponse> {
  const { apiKey, endpoint } = providerConfig(input.provider);
  const form = new FormData();
  form.set('file', new Blob([input.bytes], { type: input.asset.mimeType }), sourceFilename(input.asset));
  form.set('model', input.model);
  form.set('response_format', 'verbose_json');
  if (input.language) form.set('language', input.language);
  if (input.prompt) form.set('prompt', input.prompt);

  let response: Response;
  try {
    response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  } catch (error) {
    // An interrupted request may already have reached the provider. Failing
    // closed avoids a blind retry and a possible duplicate billed request.
    throw new Error(`Transcription request outcome is unknown: ${safeError(error)}`);
  }
  const body = await response.text();
  if (!response.ok) {
    const message = body.slice(0, 1_000) || `${response.status} ${response.statusText}`;
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      throw new RetryableAudioProviderError(`Transcription provider returned ${response.status}: ${message}`);
    }
    throw new Error(`Transcription provider returned ${response.status}: ${message}`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error(`Transcription provider returned invalid JSON: ${safeError(error)}`);
  }
  return parseProviderResponse(payload);
}

function toDerivation(input: {
  asset: MediaAsset;
  projectId: string;
  request: StoredAudioRequest;
  transcript: AudioTranscriptionResponse;
}): Omit<MediaDerivation, 'id' | 'createdAt' | 'updatedAt'> {
  const { asset, projectId, request, transcript } = input;
  const usage = transcript.usage;
  return {
    assetId: asset.id,
    projectId,
    kind: 'audio-transcript',
    content: transcript.text,
    status: 'ready',
    metadata: {
      extractor: 'audio-transcription',
      sourceAssetId: asset.id,
      provider: request.provider,
      model: request.model,
      responseFormat: 'verbose_json',
      ...(transcript.durationSeconds !== undefined ? { durationSeconds: transcript.durationSeconds } : {}),
      billing: {
        costStatus: 'not-reported',
        ...(usage?.seconds !== undefined ? { inputAudioSeconds: usage.seconds } : {}),
        ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
        ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
        ...(usage?.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
      },
    },
  };
}

function retryAfterProviderError(
  store: MediaStore,
  projectId: string,
  mediaJob: MediaJob,
  maintenanceJob: MaintenanceJob,
  error: unknown,
): MaintenanceJobRunResult {
  const message = safeError(error);
  if (!(error instanceof RetryableAudioProviderError) || maintenanceJob.attempts >= maintenanceJob.maxAttempts) {
    store.updateJobIfNotCancelled(projectId, mediaJob.id, { status: 'failed', lastError: message, incrementAttempts: true });
    return { action: 'complete' };
  }
  if (!store.updateJobIfNotCancelled(projectId, mediaJob.id, { status: 'retry', lastError: message, incrementAttempts: true })) {
    return { action: 'complete' };
  }
  return { action: 'reschedule', delayMs: 5_000, status: 'retry', lastError: message };
}

/** Queue an explicit, opt-in audio derivative. Credentials never enter SQLite. */
export function queueAudioTranscription(input: QueueAudioTranscriptionInput): QueuedAudioTranscription {
  const provider = parseProvider(input.provider ?? (process.env.MEMORIX_TRANSCRIPTION_PROVIDER?.trim() || 'openai'));
  providerConfig(provider);
  const request: StoredAudioRequest = {
    provider,
    model: trimOptional(input.model ?? process.env.MEMORIX_TRANSCRIPTION_MODEL, 'model', 160) ?? defaultModel(provider),
    ...(trimOptional(input.language, 'language', 32) ? { language: trimOptional(input.language, 'language', 32) } : {}),
    ...(trimOptional(input.prompt, 'prompt', 1_000) ? { prompt: trimOptional(input.prompt, 'prompt', 1_000) } : {}),
    maxBytes: parseMaxBytes(input.maxBytes),
  };
  const store = new MediaStore(input.dataDir);
  const asset = store.getAsset(input.projectId, input.assetId);
  if (!asset) throw new Error(`Media asset not found: ${input.assetId}`);
  if (asset.kind !== 'audio') throw new Error(`Media asset ${input.assetId} is ${asset.kind}, not audio`);
  if (asset.byteSize > request.maxBytes) throw new Error(`Audio asset exceeds transcription limit (${asset.byteSize} bytes; limit ${request.maxBytes})`);
  const mediaJob = store.createJob({
    projectId: input.projectId,
    kind: 'audio-transcription',
    request: { ...request },
    sourceAssetId: asset.id,
    attachOnComplete: input.attachOnComplete,
    observationTitle: input.observationTitle,
  });
  const maintenanceJob = new MaintenanceJobStore(input.dataDir).enqueue({
    projectId: input.projectId,
    kind: MEDIA_AUDIO_MAINTENANCE_KIND,
    dedupeKey: `media-audio:${mediaJob.id}`,
    payload: { mediaJobId: mediaJob.id },
    maxAttempts: MAX_AUDIO_TRANSCRIPTION_ATTEMPTS,
  });
  return { mediaJob, maintenanceJob };
}

export async function runAudioTranscriptionJob(
  maintenanceJob: MaintenanceJob,
  context: { dataDir: string; projectId: string },
  dependencies: AudioTranscriptionDependencies = {},
): Promise<MaintenanceJobRunResult> {
  const mediaJobId = mediaJobIdFromMaintenance(maintenanceJob);
  const store = new MediaStore(context.dataDir);
  const mediaJob = store.getJob(context.projectId, mediaJobId);
  if (!mediaJob || terminal(mediaJob)) return { action: 'complete' };
  if (mediaJob.kind !== 'audio-transcription') throw new Error(`Unsupported media job kind: ${mediaJob.kind}`);
  if (!mediaJob.sourceAssetId) {
    store.updateJobIfNotCancelled(context.projectId, mediaJob.id, { status: 'cancelled', lastError: 'Audio source asset is unavailable' });
    return { action: 'complete' };
  }
  const request = parseStoredRequest(mediaJob.request);
  const asset = store.getAsset(context.projectId, mediaJob.sourceAssetId);
  if (!asset || asset.kind !== 'audio') {
    store.updateJobIfNotCancelled(context.projectId, mediaJob.id, { status: 'cancelled', lastError: 'Audio source asset is unavailable' });
    return { action: 'complete' };
  }

  const existing = store.listDerivations(context.projectId, asset.id)
    .find((derivation) => derivation.kind === 'audio-transcript' && derivation.status === 'ready');
  let derivation = existing;
  if (!derivation) {
    if (!store.updateJobIfNotCancelled(context.projectId, mediaJob.id, { status: 'submitting', incrementAttempts: true })) {
      return { action: 'complete' };
    }
    try {
      const transcript = await (dependencies.transcribe ?? transcribeAudio)({
        provider: request.provider,
        model: request.model,
        ...(request.language ? { language: request.language } : {}),
        ...(request.prompt ? { prompt: request.prompt } : {}),
        asset,
        bytes: await readMediaAsset(context.dataDir, asset, request.maxBytes),
      });
      derivation = store.addDerivation(toDerivation({ asset, projectId: context.projectId, request, transcript }));
    } catch (error) {
      return retryAfterProviderError(store, context.projectId, mediaJob, maintenanceJob, error);
    }
  }

  const activeJob = store.getJob(context.projectId, mediaJob.id);
  if (!activeJob || terminal(activeJob)) return { action: 'complete' };
  if (activeJob.attachOnComplete) {
    const hasAttachment = store.listLinks(context.projectId, asset.id)
      .some((link) => link.role === 'attachment' && link.observationId !== undefined);
    if (!hasAttachment) {
      await (dependencies.attach ?? attachMediaAssetToObservation)({
        dataDir: context.dataDir,
        projectId: context.projectId,
        asset,
        title: activeJob.observationTitle ?? `Audio transcript: ${asset.sourceLabel ?? asset.id}`,
        narrative: derivation.content,
        facts: [
          'Derived with explicit audio transcription.',
          `Transcription provider: ${request.provider}`,
          `Transcription model: ${request.model}`,
        ],
        concepts: ['audio', 'audio-transcript', 'media-derivation', request.provider, request.model],
      });
    }
  }
  store.updateJobIfNotCancelled(context.projectId, mediaJob.id, { status: 'completed' });
  return { action: 'complete' };
}

export function resolveMediaAudioRunnerPath(moduleUrl = import.meta.url): string {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const parentDir = path.dirname(moduleDir);
  const distDir = path.basename(moduleDir) === 'cli'
    ? parentDir
    : path.basename(moduleDir) === 'media' && path.basename(parentDir) === 'src'
      ? path.join(path.dirname(parentDir), 'dist')
      : moduleDir;
  return path.join(distDir, 'media-audio-runner.js');
}

/** Kick a short-lived worker for CLI users without opening a Windows console. */
export function launchMediaAudioRunner(
  request: MediaAudioRunnerRequest,
  options: { runnerPath?: string } = {},
): { launched: boolean; reason?: string } {
  const runnerPath = options.runnerPath ?? resolveMediaAudioRunnerPath();
  if (!existsSync(runnerPath)) return { launched: false, reason: 'Audio runner is unavailable until Memorix is built or reinstalled.' };
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
