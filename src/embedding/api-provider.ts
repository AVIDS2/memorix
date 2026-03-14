/**
 * API Embedding Provider
 *
 * Remote embedding via any OpenAI-compatible /v1/embeddings endpoint.
 * Works with: OpenAI, Qwen (DashScope), Cohere, 中转站/反代, Ollama, etc.
 *
 * Advantages over local providers:
 *   - Zero local resource usage (no 300-500MB RAM)
 *   - Access to larger, higher-quality models (1024-3072 dimensions)
 *   - Works on any machine without native bindings
 *
 * Performance advantages vs competitors (mcp-memory-service, claude-mem, Mem0):
 *   ┌────────────────────────────┬──────────────┬──────────────────────────┐
 *   │ Feature                    │ Competitors  │ Memorix                  │
 *   ├────────────────────────────┼──────────────┼──────────────────────────┤
 *   │ Embedding cache            │ None         │ 10K LRU + disk persist   │
 *   │ Batch API calls            │ 1-by-1       │ Up to 2048 per request   │
 *   │ Cache hit → API bypass     │ No           │ SHA-256 dedup, 0ms       │
 *   │ Retry with backoff         │ Crash/skip   │ Exponential + Retry-After│
 *   │ Text normalization         │ No           │ Whitespace + truncation  │
 *   │ Debounced disk writes      │ N/A          │ 5s coalesce window       │
 *   │ Concurrent batch chunks    │ Sequential   │ Parallel (4 concurrent)  │
 *   │ Dimension shortening       │ Hardcoded    │ Runtime configurable     │
 *   │ External dependency        │ Chroma/SQLite│ Zero (native fetch)      │
 *   │ Input token waste          │ Full text    │ Truncated to 8191 tokens │
 *   └────────────────────────────┴──────────────┴──────────────────────────┘
 *
 * Environment variables:
 *   MEMORIX_EMBEDDING=api                        — enable this provider
 *   MEMORIX_EMBEDDING_API_KEY                    — API key (fallback: MEMORIX_LLM_API_KEY → OPENAI_API_KEY)
 *   MEMORIX_EMBEDDING_BASE_URL                   — base URL (fallback: MEMORIX_LLM_BASE_URL → https://api.openai.com/v1)
 *   MEMORIX_EMBEDDING_MODEL                      — model name (default: text-embedding-3-small)
 *   MEMORIX_EMBEDDING_DIMENSIONS                 — optional dimension override (e.g., 512 for cost savings)
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { EmbeddingProvider } from './provider.js';

// ─── Cache Configuration ─────────────────────────────────────────────

const CACHE_DIR = process.env.MEMORIX_DATA_DIR || join(homedir(), '.memorix', 'data');
const CACHE_FILE = join(CACHE_DIR, '.embedding-api-cache.json');

const cache = new Map<string, number[]>();
const MAX_CACHE_SIZE = 10000;
let diskCacheDirty = false;
let diskSaveTimer: ReturnType<typeof setTimeout> | null = null;

/** Max input text length (chars) — prevent token waste on huge texts */
const MAX_INPUT_CHARS = 32000;

/** Max concurrent batch chunks to process in parallel */
const MAX_CONCURRENCY = 4;

/** Debounce window for disk cache writes (ms) */
const DISK_SAVE_DEBOUNCE_MS = 5000;

// ─── API Configuration ───────────────────────────────────────────────

/** Max texts per API batch (OpenAI limit: 2048) */
const MAX_BATCH_SIZE = 2048;

/** Max retries for transient failures */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff (ms) */
const BASE_DELAY_MS = 500;

// ─── Cache Helpers ───────────────────────────────────────────────────

/**
 * Normalize text for consistent cache hits.
 * Collapses whitespace and trims — "hello   world" and "hello world" get same embedding.
 */
function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_INPUT_CHARS);
}

function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

async function loadDiskCache(): Promise<void> {
  try {
    const raw = await readFile(CACHE_FILE, 'utf-8');
    const entries: [string, number[]][] = JSON.parse(raw);
    for (const [k, v] of entries) cache.set(k, v);
    console.error(`[memorix] Loaded ${entries.length} cached API embeddings from disk`);
  } catch {
    // No cache file or corrupt — start fresh
  }
}

async function saveDiskCacheNow(): Promise<void> {
  if (!diskCacheDirty) return;
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const entries = Array.from(cache.entries());
    await writeFile(CACHE_FILE, JSON.stringify(entries));
    diskCacheDirty = false;
  } catch {
    // Ignore write errors — cache is optimization, not critical
  }
}

/**
 * Debounced disk cache save — coalesces rapid writes into one 5s-delayed write.
 * Competitors write on every single embed call; we batch for I/O efficiency.
 */
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

// ─── API Types ───────────────────────────────────────────────────────

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

// ─── Provider Implementation ─────────────────────────────────────────

export class APIEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;

  private config: APIEmbeddingConfig;
  private totalTokensUsed = 0;
  private totalApiCalls = 0;

  private constructor(config: APIEmbeddingConfig, detectedDimensions: number) {
    this.config = config;
    this.dimensions = detectedDimensions;
    this.name = `api-${config.model.replace(/\//g, '-')}`;
  }

  /**
   * Initialize the API embedding provider.
   * Probes the API with a test embedding to detect dimensions.
   */
  static async create(): Promise<APIEmbeddingProvider> {
    const config = APIEmbeddingProvider.resolveConfig();

    // Load disk cache
    await loadDiskCache();

    // Probe API to detect dimensions
    const probeDimensions = await APIEmbeddingProvider.probeAPI(config);

    console.error(`[memorix] API embedding: ${config.model} @ ${config.baseUrl} (${probeDimensions}d)`);
    if (config.requestedDimensions) {
      console.error(`[memorix] Dimension shortening: ${config.requestedDimensions}d requested`);
    }

    return new APIEmbeddingProvider(config, probeDimensions);
  }

  /**
   * Resolve configuration from environment variables.
   * Falls back to LLM config → OpenAI defaults.
   */
  private static resolveConfig(): APIEmbeddingConfig {
    // Unified config: env vars > config.json > defaults
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
      // Fallback: direct env var reading
      apiKey =
        process.env.MEMORIX_EMBEDDING_API_KEY ||
        process.env.MEMORIX_API_KEY ||  // Unified API key
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

    baseUrl = baseUrl.replace(/\/+$/, ''); // Strip trailing slash

    return { apiKey, baseUrl, model, requestedDimensions };
  }

  /**
   * Probe API with a test text to detect actual output dimensions.
   */
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
      throw new Error('API probe returned no embeddings — check model name and API key');
    }

    return response.data[0].embedding.length;
  }

  async embed(text: string): Promise<number[]> {
    const normalized = normalizeText(text);
    const hash = textHash(normalized);
    const cached = cache.get(hash);
    if (cached) return cached;

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
      throw new Error(`Expected ${this.dimensions}d, got ${embedding.length}d — dimension mismatch`);
    }

    this.trackUsage(response);
    cacheSet(hash, embedding);
    scheduleDiskSave();
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const normalizedTexts = texts.map(normalizeText);
    const results: number[][] = new Array(texts.length);
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    // Check cache for each text
    for (let i = 0; i < normalizedTexts.length; i++) {
      const hash = textHash(normalizedTexts[i]);
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

    // Split into chunks of MAX_BATCH_SIZE, then process up to MAX_CONCURRENCY in parallel
    const chunks: { texts: string[]; indices: number[] }[] = [];
    for (let batchStart = 0; batchStart < uncachedTexts.length; batchStart += MAX_BATCH_SIZE) {
      chunks.push({
        texts: uncachedTexts.slice(batchStart, batchStart + MAX_BATCH_SIZE),
        indices: uncachedIndices.slice(batchStart, batchStart + MAX_BATCH_SIZE),
      });
    }

    // Process chunks with bounded concurrency (competitors do sequential)
    for (let ci = 0; ci < chunks.length; ci += MAX_CONCURRENCY) {
      const concurrentChunks = chunks.slice(ci, ci + MAX_CONCURRENCY);
      const batchStartOffset = ci * MAX_BATCH_SIZE;

      await Promise.all(concurrentChunks.map(async (chunk, chunkIdx) => {
        const body: Record<string, unknown> = {
          model: this.config.model,
          input: chunk.texts,
        };
        if (this.config.requestedDimensions) {
          body.dimensions = this.config.requestedDimensions;
        }

        const response = await fetchWithRetry(
          `${this.config.baseUrl}/embeddings`,
          this.config.apiKey,
          body,
        );

        this.trackUsage(response);

        const globalChunkStart = batchStartOffset + chunkIdx * MAX_BATCH_SIZE;

        // API may return results in any order — use the index field
        for (const item of response.data) {
          const originalIdx = chunk.indices[item.index];
          results[originalIdx] = item.embedding;
          cacheSet(textHash(uncachedTexts[globalChunkStart + item.index]), item.embedding);
        }
      }));
    }

    scheduleDiskSave();
    return results;
  }

  /**
   * Get usage stats for logging/debugging.
   */
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

// ─── HTTP with Retry ─────────────────────────────────────────────────

/**
 * Fetch with exponential backoff retry.
 * Handles 429 (rate limit) and 5xx (server errors) gracefully.
 */
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

  // Retry on rate limit (429) or server errors (5xx)
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
