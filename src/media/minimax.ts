import {
  generateImages,
  getImageModel,
  type ImageContent,
  type ImagesInputContent,
} from '@memorix/ai';

import { sanitizeCredentials } from '../memory/secret-filter.js';
import { importMediaBuffer } from './asset-store.js';
import type { MediaImportResult } from './types.js';

const IMAGE_MODELS = ['image-01', 'image-01-live'] as const;
const MAX_PROMPT_LENGTH = 12_000;
const DEFAULT_IMAGE_TIMEOUT_MS = 90_000;

export type MiniMaxImageModel = typeof IMAGE_MODELS[number];
export type MiniMaxRegion = 'global' | 'cn';
export type MiniMaxVideoModel = 'MiniMax-H3';
export type MiniMaxVideoResolution = '2K';
export type MiniMaxVideoRatio = 'adaptive' | '16:9' | '9:16' | '1:1';

export interface MiniMaxImageGenerationInput {
  dataDir: string;
  projectId: string;
  prompt: string;
  model?: MiniMaxImageModel;
  region?: MiniMaxRegion;
  apiKey?: string;
  baseUrl?: string;
  n?: number;
  aspectRatio?: '1:1' | '16:9' | '4:3' | '3:2' | '2:3' | '3:4' | '9:16' | '21:9';
  width?: number;
  height?: number;
  seed?: number;
  promptOptimizer?: boolean;
  subjectImages?: Array<{ data: string; mimeType: string }>;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface GeneratedMiniMaxImages {
  provider: 'minimax' | 'minimax-cn';
  model: MiniMaxImageModel;
  responseId?: string;
  assets: MediaImportResult[];
}

export interface MiniMaxVideoGenerationRequest {
  prompt: string;
  model?: MiniMaxVideoModel;
  region?: MiniMaxRegion;
  apiKey?: string;
  baseUrl?: string;
  resolution?: MiniMaxVideoResolution;
  duration?: 5 | 10;
  ratio?: MiniMaxVideoRatio;
  timeoutMs?: number;
}

export interface MiniMaxVideoTask {
  taskId: string;
  status: 'pending' | 'succeeded' | 'failed';
  downloadUrl?: string;
  error?: string;
}

export interface MiniMaxVideoTransport {
  fetch?: typeof fetch;
}

export interface MiniMaxImageGenerator {
  (input: {
    provider: 'minimax' | 'minimax-cn';
    model: MiniMaxImageModel;
    apiKey: string;
    baseUrl?: string;
    prompt: string;
    n?: number;
    aspectRatio?: MiniMaxImageGenerationInput['aspectRatio'];
    width?: number;
    height?: number;
    seed?: number;
    promptOptimizer?: boolean;
    subjectImages?: Array<{ data: string; mimeType: string }>;
    timeoutMs: number;
  }): Promise<{ responseId?: string; output: ImageContent[] }>;
}

function requiredString(value: string | undefined, label: string): string {
  const result = value?.trim();
  if (!result) throw new Error(`${label} is required`);
  return result;
}

function resolveRegion(value: MiniMaxRegion | undefined): MiniMaxRegion {
  const configured = value ?? process.env.MINIMAX_REGION?.trim().toLowerCase();
  if (!configured || configured === 'global') return 'global';
  if (configured === 'cn') return 'cn';
  throw new Error('MiniMax region must be "global" or "cn"');
}

function resolveImageModel(value: string | undefined): MiniMaxImageModel {
  const model = value?.trim() || process.env.MINIMAX_IMAGE_MODEL?.trim() || 'image-01';
  if ((IMAGE_MODELS as readonly string[]).includes(model)) return model as MiniMaxImageModel;
  throw new Error(`Unsupported MiniMax image model: ${model}. Supported models: ${IMAGE_MODELS.join(', ')}`);
}

function resolveBaseUrl(value: string | undefined): string | undefined {
  const baseUrl = value?.trim();
  if (!baseUrl) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('MINIMAX_IMAGE_BASE_URL must be a valid HTTPS URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('MINIMAX_IMAGE_BASE_URL must be an HTTPS URL without credentials');
  }
  return parsed.toString().replace(/\/$/, '');
}

function resolveVideoBaseUrl(region: MiniMaxRegion, value: string | undefined): string {
  const configured = value?.trim()
    || process.env.MINIMAX_VIDEO_BASE_URL?.trim()
    || (region === 'cn' ? 'https://api.minimaxi.com' : 'https://api.minimax.io');
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('MINIMAX_VIDEO_BASE_URL must be a valid HTTPS URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('MINIMAX_VIDEO_BASE_URL must be an HTTPS URL without credentials');
  }
  return parsed.toString().replace(/\/$/, '');
}

function normalizePrompt(value: string): string {
  const prompt = value.trim();
  if (!prompt) throw new Error('MiniMax image generation requires a non-empty prompt');
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`MiniMax image prompt exceeds the ${MAX_PROMPT_LENGTH}-character limit`);
  }
  return prompt;
}

function sourceLabel(model: MiniMaxImageModel, index: number): string {
  return `minimax-${model}-${index + 1}`;
}

function safeError(error: unknown): Error {
  const message = sanitizeCredentials(error instanceof Error ? error.message : String(error));
  return new Error(message.slice(0, 1_000));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeMiniMaxVideoRequest(input: MiniMaxVideoGenerationRequest): {
  region: MiniMaxRegion;
  model: MiniMaxVideoModel;
  prompt: string;
  resolution: MiniMaxVideoResolution;
  duration: 5 | 10;
  ratio: MiniMaxVideoRatio;
} {
  const region = resolveRegion(input.region);
  const model = input.model ?? (process.env.MINIMAX_VIDEO_MODEL?.trim() as MiniMaxVideoModel | undefined) ?? 'MiniMax-H3';
  if (model !== 'MiniMax-H3') throw new Error(`Unsupported MiniMax video model: ${model}`);
  const prompt = normalizePrompt(input.prompt);
  const resolution = input.resolution ?? '2K';
  if (resolution !== '2K') throw new Error(`Unsupported MiniMax video resolution: ${resolution}`);
  const duration = input.duration ?? 5;
  if (duration !== 5 && duration !== 10) throw new Error('MiniMax video duration must be 5 or 10 seconds');
  const ratio = input.ratio ?? 'adaptive';
  if (ratio !== 'adaptive' && ratio !== '16:9' && ratio !== '9:16' && ratio !== '1:1') {
    throw new Error('MiniMax video ratio must be adaptive, 16:9, 9:16, or 1:1');
  }
  return { region, model, prompt, resolution, duration, ratio };
}

function videoRequestConfig(input: MiniMaxVideoGenerationRequest): {
  region: MiniMaxRegion;
  apiKey: string;
  baseUrl: string;
  model: MiniMaxVideoModel;
  prompt: string;
  resolution: MiniMaxVideoResolution;
  duration: 5 | 10;
  ratio: MiniMaxVideoRatio;
  timeoutMs: number;
} {
  const normalized = normalizeMiniMaxVideoRequest(input);
  const timeoutMs = input.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 5 * 60_000) {
    throw new Error('MiniMax video timeout must be between 1000 and 300000 milliseconds');
  }
  return {
    ...normalized,
    apiKey: requiredString(
      input.apiKey ?? (normalized.region === 'cn' ? process.env.MINIMAX_CN_API_KEY : process.env.MINIMAX_API_KEY),
      normalized.region === 'cn' ? 'MINIMAX_CN_API_KEY' : 'MINIMAX_API_KEY',
    ),
    baseUrl: resolveVideoBaseUrl(normalized.region, input.baseUrl),
    timeoutMs,
  };
}

async function readMiniMaxJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let body: Record<string, unknown> = {};
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (isRecord(parsed)) body = parsed;
    } catch {
      throw new Error('MiniMax video API returned invalid JSON');
    }
  }
  if (!response.ok) {
    const error = isRecord(body.error) && typeof body.error.message === 'string'
      ? body.error.message
      : typeof body.message === 'string'
        ? body.message
        : `HTTP ${response.status}`;
    throw new Error(`MiniMax video API failed: ${error}`);
  }
  if (isRecord(body.error) && typeof body.error.message === 'string') {
    throw new Error(`MiniMax video API failed: ${body.error.message}`);
  }
  return body;
}

function videoHeaders(apiKey: string): Headers {
  return new Headers({
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  });
}

function nestedTask(body: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!isRecord(body.task)) return undefined;
  return isRecord(body.task.task) ? body.task.task : body.task;
}

function taskError(task: Record<string, unknown>): string | undefined {
  if (typeof task.error === 'string') return task.error;
  if (isRecord(task.error) && typeof task.error.message === 'string') return task.error.message;
  return undefined;
}

function parseVideoTask(body: Record<string, unknown>): MiniMaxVideoTask {
  const task = nestedTask(body);
  const taskId = typeof body.task_id === 'string'
    ? body.task_id
    : typeof task?.id === 'string'
      ? task.id
      : undefined;
  if (!taskId) throw new Error('MiniMax video API response did not include a task ID');
  const providerStatus = typeof task?.status === 'string' ? task.status.toLowerCase() : 'pending';
  if (providerStatus === 'succeeded' || providerStatus === 'success' || providerStatus === 'completed') {
    const content = isRecord(task?.content) ? task.content : undefined;
    const downloadUrl = typeof content?.url === 'string' ? content.url : undefined;
    if (!downloadUrl) throw new Error('MiniMax video task succeeded without a download URL');
    return { taskId, status: 'succeeded', downloadUrl };
  }
  if (providerStatus === 'failed' || providerStatus === 'error' || providerStatus === 'cancelled' || providerStatus === 'canceled') {
    return { taskId, status: 'failed', ...(taskError(task ?? {}) ? { error: taskError(task ?? {}) } : {}) };
  }
  return { taskId, status: 'pending' };
}

/** Submit a billable MiniMax V2 task exactly once. Queue retry policy belongs to the caller. */
export async function createMiniMaxVideoTask(
  input: MiniMaxVideoGenerationRequest,
  dependencies: MiniMaxVideoTransport = {},
): Promise<MiniMaxVideoTask> {
  const config = videoRequestConfig(input);
  try {
    const response = await (dependencies.fetch ?? fetch)(`${config.baseUrl}/v2/video_generation`, {
      method: 'POST',
      headers: videoHeaders(config.apiKey),
      body: JSON.stringify({
        model: config.model,
        content: [{ type: 'text', text: config.prompt }],
        resolution: config.resolution,
        duration: config.duration,
        ratio: config.ratio,
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    return parseVideoTask(await readMiniMaxJson(response));
  } catch (error) {
    throw safeError(error);
  }
}

/** Query only the durable provider task. The temporary result URL is returned to the caller, never persisted. */
export async function queryMiniMaxVideoTask(
  input: Omit<MiniMaxVideoGenerationRequest, 'prompt'> & { taskId: string },
  dependencies: MiniMaxVideoTransport = {},
): Promise<MiniMaxVideoTask> {
  const taskId = requiredString(input.taskId, 'MiniMax video task ID');
  const config = videoRequestConfig({ ...input, prompt: 'query' });
  try {
    const response = await (dependencies.fetch ?? fetch)(
      `${config.baseUrl}/v2/query/video_generation/${encodeURIComponent(taskId)}`,
      {
        method: 'GET',
        headers: videoHeaders(config.apiKey),
        signal: AbortSignal.timeout(config.timeoutMs),
      },
    );
    const result = parseVideoTask(await readMiniMaxJson(response));
    if (result.taskId !== taskId) throw new Error('MiniMax video API returned a mismatched task ID');
    return result;
  } catch (error) {
    throw safeError(error);
  }
}

const defaultImageGenerator: MiniMaxImageGenerator = async (input) => {
  const model = getImageModel(input.provider, input.model);
  if (!model) throw new Error(`MiniMax image model is not registered: ${input.model}`);
  const configuredModel = input.baseUrl ? { ...model, baseUrl: input.baseUrl } : model;
  const content: ImagesInputContent[] = [
    ...(input.subjectImages ?? []).map((image) => ({ type: 'image' as const, data: image.data, mimeType: image.mimeType })),
    { type: 'text' as const, text: input.prompt },
  ];
  const response = await generateImages(
    configuredModel,
    { input: content },
    {
      apiKey: input.apiKey,
      timeoutMs: input.timeoutMs,
      maxRetries: 0,
      responseFormat: 'base64',
      ...(input.n !== undefined ? { n: input.n } : {}),
      ...(input.aspectRatio !== undefined ? { aspectRatio: input.aspectRatio } : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      ...(input.promptOptimizer !== undefined ? { promptOptimizer: input.promptOptimizer } : {}),
    },
  );
  if (response.stopReason !== 'stop') {
    throw new Error(response.errorMessage || 'MiniMax image generation did not complete');
  }
  return {
    responseId: response.responseId,
    output: response.output.filter((item): item is ImageContent => item.type === 'image'),
  };
};

/**
 * Generates images only after an explicit operator request, then immediately
 * moves the provider result into Memorix's content-addressed asset store.
 */
export async function generateMiniMaxImages(
  input: MiniMaxImageGenerationInput,
  dependencies: { generate?: MiniMaxImageGenerator } = {},
): Promise<GeneratedMiniMaxImages> {
  const prompt = normalizePrompt(input.prompt);
  const region = resolveRegion(input.region);
  const provider = region === 'cn' ? 'minimax-cn' : 'minimax';
  const model = resolveImageModel(input.model);
  const apiKey = requiredString(
    input.apiKey ?? (region === 'cn' ? process.env.MINIMAX_CN_API_KEY : process.env.MINIMAX_API_KEY),
    region === 'cn' ? 'MINIMAX_CN_API_KEY' : 'MINIMAX_API_KEY',
  );
  const baseUrl = resolveBaseUrl(input.baseUrl ?? process.env.MINIMAX_IMAGE_BASE_URL);
  const timeoutMs = input.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 5 * 60_000) {
    throw new Error('MiniMax image timeout must be between 1000 and 300000 milliseconds');
  }

  let generated: { responseId?: string; output: ImageContent[] };
  try {
    generated = await (dependencies.generate ?? defaultImageGenerator)({
      provider,
      model,
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
      prompt,
      ...(input.n !== undefined ? { n: input.n } : {}),
      ...(input.aspectRatio !== undefined ? { aspectRatio: input.aspectRatio } : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      ...(input.promptOptimizer !== undefined ? { promptOptimizer: input.promptOptimizer } : {}),
      ...(input.subjectImages !== undefined && input.subjectImages.length > 0 ? { subjectImages: input.subjectImages } : {}),
      timeoutMs,
    });
  } catch (error) {
    throw safeError(error);
  }

  if (generated.output.length === 0) throw new Error('MiniMax image generation returned no images');
  const assets = await Promise.all(generated.output.map((image, index) => importMediaBuffer({
    dataDir: input.dataDir,
    projectId: input.projectId,
    bytes: Buffer.from(image.data, 'base64'),
    filename: sourceLabel(model, index),
    sourceKind: 'minimax-image',
    sourceLabel: sourceLabel(model, index),
    provider,
    model,
    ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
  })));

  return {
    provider,
    model,
    ...(generated.responseId ? { responseId: generated.responseId } : {}),
    assets,
  };
}
