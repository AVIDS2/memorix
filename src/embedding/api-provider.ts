/**
 * API Embedding Provider
 *
 * Remote embedding via any OpenAI-compatible /v1/embeddings endpoint.
 * Works with OpenAI, DashScope/Qwen, Ollama-compatible gateways, and similar providers.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { EmbeddingProvider } from './provider.js';

const CACHE_DIR = process.env.MEMORIX_DATA_DIR || join(homedir(), '.memorix', 'data');
const CACHE_FILE = join(CACHE_DIR, '.embedding-api-cache.json');
const DIMS_CACHE_FILE = join(CACHE_DIR, '.embedding-dims-cache.json');

const cache = new Map<string, number[]>();
const MAX_CACHE_SIZE = 10000;
let diskCacheDirty = false;
let diskSaveTimer: ReturnType<typeof setTimeout> | null = null;
let diskCacheLoaded = false;
let diskCacheLoadPromise: Promise<void> | null = null;

const MAX_INPUT_CHARS = 32000;
const MAX_CONCURRENCY = 4;
const DISK_SAVE_DEBOUNCE_MS = 5000;

const DEFAULT_MAX_BATCH_SIZE = 2048;
const DASHSCOPE_MAX_BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_INPUT_CHARS);
}

function cacheNamespace(config: Pick<APIEmbeddingConfig, 'baseUrl' | 'model' | 'requestedDimensions'>): string {
  return [
    'v2',
    config.baseUrl.replace(/\/+$/, ''),
    config.model,
    config.requestedDimensions ?? 'native',
  ].join('|');
}

function textHash(text: string, namespace: string): string {
  return createHash('sha256').update(`${namespace}\u0000${text}`).digest('hex').slice(0, 16);
}

async function loadDiskCache(): Promise<void> {
  if (diskCacheLoaded) return;
  try {
    const raw = await readFile(CACHE_FILE, 'utf-8');
    const entries: [string, number[]][] = JSON.parse(raw);
    for (const [k, v] of entries) cache.set(k, v);
    console.error(`[memorix] Loaded ${entries.length} cached API embeddings from disk`);
  } catch {
    // No cache file or corrupt cache; start fresh.
  }
  diskCacheLoaded = true;
}

/** Start loading disk cache in background (non-blocking). */
function startDiskCacheLoad(): void {
  if (diskCacheLoaded || diskCacheLoadPromise) return;
  diskCacheLoadPromise = loadDiskCache().catch(() => {});
}

/** Ensure disk cache is loaded (await if still in progress). */
async function ensureDiskCacheLoaded(): Promise<void> {
  if (diskCacheLoaded) return;
  if (diskCacheLoadPromise) { await diskCacheLoadPromise; return; }
  await loadDiskCache();
}

function dimsCacheKey(config: Pick<APIEmbeddingConfig, 'baseUrl' | 'model' | 'requestedDimensions'>): string {
  return [
    config.baseUrl.replace(/\/+$/, ''),
    config.model,
    config.requestedDimensions ?? 'native',
  ].join('|');
}

/** Load cached probe dimensions from disk. Returns null if not cached. */
async function loadCachedDims(config: Pick<APIEmbeddingConfig, 'baseUrl' | 'model' | 'requestedDimensions'>): Promise<number | null> {
  try {
    const raw = await readFile(DIMS_CACHE_FILE, 'utf-8');
    const data = JSON.parse(raw);

    const key = dimsCacheKey(config);

    if (Array.isArray(data.entries)) {
      const entry = data.entries.find((candidate: unknown) =>
        typeof candidate === 'object' &&
        candidate !== null &&
        'key' in candidate &&
        'dimensions' in candidate &&
        (candidate as { key?: string }).key === key &&
        typeof (candidate as { dimensions?: unknown }).dimensions === 'number',
      ) as { dimensions: number } | undefined;
      if (entry) return entry.dimensions;
    }

    if (
      data.baseUrl === config.baseUrl &&
      data.model === config.model &&
      typeof data.dimensions === 'number' &&
      (data.requestedDimensions ?? null) === (config.requestedDimensions ?? null)
    ) {
      return data.dimensions;
    }

    if (
      data.baseUrl === config.baseUrl &&
      data.model === config.model &&
      typeof data.dimensions === 'number' &&
      (config.requestedDimensions ?? null) === null &&
      !('requestedDimensions' in data)
    ) {
      return data.dimensions;
    }
  } catch { /* no cache or corrupt */ }
  return null;
}

/** Persist probe dimensions for fast subsequent starts. */
async function saveCachedDims(config: Pick<APIEmbeddingConfig, 'baseUrl' | 'model' | 'requestedDimensions'>, dimensions: number): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const key = dimsCacheKey(config);
    let entries: Array<{ key: string; baseUrl: string; model: string; requestedDimensions: number | null; dimensions: number; ts: number }> = [];

    try {
      const raw = await readFile(DIMS_CACHE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.entries)) {
        entries = data.entries.filter((entry: unknown) =>
          typeof entry === 'object' &&
          entry !== null &&
          'key' in entry &&
          typeof (entry as { key?: unknown }).key === 'string',
        ) as typeof entries;
      } else if (
        data &&
        typeof data === 'object' &&
        typeof data.baseUrl === 'string' &&
        typeof data.model === 'string' &&
        typeof data.dimensions === 'number'
      ) {
        entries = [{
          key: dimsCacheKey({
            baseUrl: data.baseUrl,
            model: data.model,
            requestedDimensions: data.requestedDimensions ?? null,
          }),
          baseUrl: data.baseUrl,
          model: data.model,
          requestedDimensions: data.requestedDimensions ?? null,
          dimensions: data.dimensions,
          ts: typeof data.ts === 'number' ? data.ts : Date.now(),
        }];
      }
    } catch {
      // no existing cache
    }

    const nextEntry = {
      key,
      baseUrl: config.baseUrl,
      model: config.model,
      requestedDimensions: config.requestedDimensions ?? null,
      dimensions,
      ts: Date.now(),
    };

    entries = entries.filter((entry) => entry.key !== key);
    entries.push(nextEntry);

    await writeFile(DIMS_CACHE_FILE, JSON.stringify({ entries }));
  } catch { /* best-effort */ }
}

async function saveDiskCacheNow(): Promise<void> {
  if (!diskCacheDirty) return;
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const entries = Array.from(cache.entries());
    await writeFile(CACHE_FILE, JSON.stringify(entries));
    diskCacheDirty = false;
  } catch {
    // Cache persistence is best-effort only.
  }
}

function scheduleDiskSave(): void {
  if (diskSaveTimer) clearTimeout(diskSaveTimer);
  diskSaveTimer = setTimeout(() => {
    saveDiskCacheNow().catch(() => {});
    diskSaveTimer = null;
  }, DISK_SAVE_DEBOUNCE_MS);
}

function cacheSet(hash: string, value: number[]): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(hash, value);
  diskCacheDirty = true;
}

interface EmbeddingAPIResponse {
  object: string;
  data: Array<{
    object: string;
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

interface APIEmbeddingConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  requestedDimensions: number | null;
}

function getPreferredBatchSize(config: APIEmbeddingConfig): number {
  if (/dashscope\.aliyuncs\.com/i.test(config.baseUrl)) {
    return DASHSCOPE_MAX_BATCH_SIZE;
  }
  return DEFAULT_MAX_BATCH_SIZE;
}

function parseBatchLimit(error: unknown): number | null {
  if (!(error instanceof Error)) return null;

  const explicit = error.message.match(/should not be larger than\s+(\d+)/i);
  if (explicit) return parseInt(explicit[1], 10);

  if (/batch size/i.test(error.message)) {
    const fallback = error.message.match(/(\d+)/);
    if (fallback) return parseInt(fallback[1], 10);
  }

  return null;
}

export class APIEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;

  private config: APIEmbeddingConfig;
  private readonly cacheKeyNamespace: string;
  private totalTokensUsed = 0;
  private totalApiCalls = 0;

  private constructor(config: APIEmbeddingConfig, detectedDimensions: number) {
    this.config = config;
    this.cacheKeyNamespace = cacheNamespace(config);
    this.dimensions = detectedDimensions;
    this.name = `api-${config.model.replace(/\//g, '-')}`;
  }

  static async create(): Promise<APIEmbeddingProvider> {
    const config = APIEmbeddingProvider.resolveConfig();

    // Start loading the 45MB+ embedding cache in the background (non-blocking).
    // It will be awaited on first embed() call if not yet ready.
    startDiskCacheLoad();

    // Try cached dimensions first to avoid a network probe on cold start
    let probeDimensions = await loadCachedDims(config);
    if (probeDimensions !== null) {
      console.error(`[memorix] API embedding: ${config.model} @ ${config.baseUrl} (${probeDimensions}d) [cached dims]`);
    } else {
      probeDimensions = await APIEmbeddingProvider.probeAPI(config);
      console.error(`[memorix] API embedding: ${config.model} @ ${config.baseUrl} (${probeDimensions}d)`);
      // Persist for next cold start
      saveCachedDims(config, probeDimensions).catch(() => {});
    }
    if (config.requestedDimensions) {
      console.error(`[memorix] Dimension shortening: ${config.requestedDimensions}d requested`);
    }

    return new APIEmbeddingProvider(config, probeDimensions);
  }

  private static resolveConfig(): APIEmbeddingConfig {
    let apiKey: string | undefined;
    let baseUrl: string;
    let model: string;
    let requestedDimensions: number | null;

    try {
      const cfg = require('../config.js');
      apiKey = cfg.getEmbeddingApiKey();
      baseUrl = cfg.getEmbeddingBaseUrl();
      model = cfg.getEmbeddingModel();
      requestedDimensions = cfg.getEmbeddingDimensions();
    } catch {
      apiKey =
        process.env.MEMORIX_EMBEDDING_API_KEY ||
        process.env.MEMORIX_API_KEY ||
        process.env.MEMORIX_LLM_API_KEY ||
        process.env.OPENAI_API_KEY;
      baseUrl =
        process.env.MEMORIX_EMBEDDING_BASE_URL ||
        process.env.MEMORIX_LLM_BASE_URL ||
        'https://api.openai.com/v1';
      model = process.env.MEMORIX_EMBEDDING_MODEL || 'text-embedding-3-small';
      const dimStr = process.env.MEMORIX_EMBEDDING_DIMENSIONS;
      requestedDimensions = dimStr ? parseInt(dimStr, 10) : null;
    }

    if (!apiKey) {
      throw new Error(
        'No API key for embedding. Set MEMORIX_EMBEDDING_API_KEY, MEMORIX_LLM_API_KEY, or OPENAI_API_KEY, or run `memorix configure`.',
      );
    }

    baseUrl = baseUrl.replace(/\/+$/, '');

    return { apiKey, baseUrl, model, requestedDimensions };
  }

  private static async probeAPI(config: APIEmbeddingConfig): Promise<number> {
    const body: Record<string, unknown> = {
      model: config.model,
      input: 'dimension probe',
    };
    if (config.requestedDimensions) {
      body.dimensions = config.requestedDimensions;
    }

    const response = await fetchWithRetry(
      `${config.baseUrl}/embeddings`,
      config.apiKey,
      body,
    );

    if (response.data.length === 0 || !response.data[0].embedding) {
      throw new Error('API probe returned no embeddings; check model name and API key');
    }

    return response.data[0].embedding.length;
  }

  async embed(text: string): Promise<number[]> {
    const normalized = normalizeText(text);
    const hash = textHash(normalized, this.cacheKeyNamespace);

    // Fast path: cache already loaded (warm process) — instant lookup
    if (diskCacheLoaded) {
      const cached = cache.get(hash);
      if (cached) return cached;
    }

    // Cold-start path: cache is still loading in background.
    // Race the cache completion (may have a hit) against the API call.
    // Whichever resolves first with a valid embedding wins.
    const apiCall = async (): Promise<number[]> => {
      const body: Record<string, unknown> = {
        model: this.config.model,
        input: normalized,
      };
      if (this.config.requestedDimensions) {
        body.dimensions = this.config.requestedDimensions;
      }
      const response = await fetchWithRetry(
        `${this.config.baseUrl}/embeddings`,
        this.config.apiKey,
        body,
      );
      const embedding = response.data[0].embedding;
      if (embedding.length !== this.dimensions) {
        throw new Error(`Expected ${this.dimensions}d, got ${embedding.length}d; dimension mismatch`);
      }
      this.trackUsage(response);
      return embedding;
    };

    let embedding: number[];

    if (!diskCacheLoaded && diskCacheLoadPromise) {
      // Race: cache load + lookup vs API call
      const cacheRace = diskCacheLoadPromise.then(() => {
        const cached = cache.get(hash);
        if (cached) return cached;
        return null; // miss — let API win
      });

      const result = await Promise.race([
        cacheRace,
        apiCall().then(v => ({ __api: true, v } as const)),
      ]);

      if (result && typeof result === 'object' && '__api' in result) {
        // API finished first
        embedding = result.v;
      } else if (result) {
        // Cache hit won the race
        return result as number[];
      } else {
        // Cache loaded but missed — await the API call
        embedding = await apiCall();
      }
    } else {
      // No cache loading — just call API
      embedding = await apiCall();
    }

    cacheSet(hash, embedding);
    scheduleDiskSave();
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await ensureDiskCacheLoaded();
    const normalizedTexts = texts.map(normalizeText);
    const results: number[][] = new Array(texts.length);
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    for (let i = 0; i < normalizedTexts.length; i++) {
      const hash = textHash(normalizedTexts[i], this.cacheKeyNamespace);
      const cached = cache.get(hash);
      if (cached) {
        results[i] = cached;
      } else {
        uncachedIndices.push(i);
        uncachedTexts.push(normalizedTexts[i]);
      }
    }

    if (uncachedTexts.length === 0) return results;

    const cacheHitRate = ((texts.length - uncachedTexts.length) / texts.length * 100).toFixed(1);
    console.error(
      `[memorix] API embedding ${uncachedTexts.length}/${texts.length} texts (cache hit: ${cacheHitRate}%)`,
    );

    const processChunk = async (chunkTexts: string[], chunkIndices: number[]): Promise<void> => {
      if (chunkTexts.length === 0) return;

      const body: Record<string, unknown> = {
        model: this.config.model,
        input: chunkTexts,
      };
      if (this.config.requestedDimensions) {
        body.dimensions = this.config.requestedDimensions;
      }

      try {
        const response = await fetchWithRetry(
          `${this.config.baseUrl}/embeddings`,
          this.config.apiKey,
          body,
        );

        this.trackUsage(response);

        for (const item of response.data) {
          const originalIdx = chunkIndices[item.index];
          results[originalIdx] = item.embedding;
          cacheSet(textHash(normalizedTexts[originalIdx], this.cacheKeyNamespace), item.embedding);
        }
      } catch (error) {
        const providerLimit = parseBatchLimit(error);
        const fallbackSize = providerLimit ?? Math.ceil(chunkTexts.length / 2);

        if (chunkTexts.length > 1 && fallbackSize < chunkTexts.length) {
          console.error(
            `[memorix] Embedding batch too large for provider, retrying in chunks of ${fallbackSize}`,
          );
          for (let start = 0; start < chunkTexts.length; start += fallbackSize) {
            await processChunk(
              chunkTexts.slice(start, start + fallbackSize),
              chunkIndices.slice(start, start + fallbackSize),
            );
          }
          return;
        }

        throw error;
      }
    };

    const preferredBatchSize = getPreferredBatchSize(this.config);
    const chunks: { texts: string[]; indices: number[] }[] = [];
    for (let batchStart = 0; batchStart < uncachedTexts.length; batchStart += preferredBatchSize) {
      chunks.push({
        texts: uncachedTexts.slice(batchStart, batchStart + preferredBatchSize),
        indices: uncachedIndices.slice(batchStart, batchStart + preferredBatchSize),
      });
    }

    for (let ci = 0; ci < chunks.length; ci += MAX_CONCURRENCY) {
      const concurrentChunks = chunks.slice(ci, ci + MAX_CONCURRENCY);
      await Promise.all(concurrentChunks.map((chunk) => processChunk(chunk.texts, chunk.indices)));
    }

    scheduleDiskSave();
    return results;
  }

  getStats(): { totalTokens: number; totalApiCalls: number; cacheSize: number } {
    return {
      totalTokens: this.totalTokensUsed,
      totalApiCalls: this.totalApiCalls,
      cacheSize: cache.size,
    };
  }

  private trackUsage(response: EmbeddingAPIResponse): void {
    this.totalApiCalls++;
    if (response.usage) {
      this.totalTokensUsed += response.usage.total_tokens;
    }
  }
}

async function fetchWithRetry(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  attempt = 0,
): Promise<EmbeddingAPIResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Embedding API timeout after 10s: ${url}`);
    }
    throw err;
  }
  clearTimeout(timeout);

  if (response.ok) {
    return response.json() as Promise<EmbeddingAPIResponse>;
  }

  if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
    const delay = BASE_DELAY_MS * Math.pow(2, attempt);
    const retryAfter = response.headers.get('retry-after');
    const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;
    console.error(`[memorix] Embedding API ${response.status}, retry ${attempt + 1}/${MAX_RETRIES} in ${waitMs}ms`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
    return fetchWithRetry(url, apiKey, body, attempt + 1);
  }

  const errorText = await response.text().catch(() => 'unknown error');
  throw new Error(`Embedding API error (${response.status}): ${errorText}`);
}
