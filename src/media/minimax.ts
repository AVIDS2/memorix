import {
  generateImages,
  getImageModel,
  type ImageContent,
} from '@memorix/ai';

import { sanitizeCredentials } from '../memory/secret-filter.js';
import { importMediaBuffer } from './asset-store.js';
import type { MediaImportResult } from './types.js';

const IMAGE_MODELS = ['image-01', 'image-01-live'] as const;
const MAX_PROMPT_LENGTH = 12_000;
const DEFAULT_IMAGE_TIMEOUT_MS = 90_000;

export type MiniMaxImageModel = typeof IMAGE_MODELS[number];
export type MiniMaxRegion = 'global' | 'cn';

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
  timeoutMs?: number;
  maxBytes?: number;
}

export interface GeneratedMiniMaxImages {
  provider: 'minimax' | 'minimax-cn';
  model: MiniMaxImageModel;
  responseId?: string;
  assets: MediaImportResult[];
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

const defaultImageGenerator: MiniMaxImageGenerator = async (input) => {
  const model = getImageModel(input.provider, input.model);
  if (!model) throw new Error(`MiniMax image model is not registered: ${input.model}`);
  const configuredModel = input.baseUrl ? { ...model, baseUrl: input.baseUrl } : model;
  const response = await generateImages(
    configuredModel,
    { input: [{ type: 'text', text: input.prompt }] },
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
