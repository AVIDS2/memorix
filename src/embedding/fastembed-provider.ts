/**
 * FastEmbed Provider
 *
 * Local ONNX-based embedding using fastembed (Qdrant).
 * Model: BAAI/bge-small-en-v1.5 (384 dimensions, ~30MB)
 *
 * This is an optional dependency — if fastembed is not installed,
 * the provider module gracefully falls back to fulltext-only search.
 *
 * Persistent disk cache: embeddings are saved to ~/.memorix/data/.embedding-cache.json
 * so server restarts don't need to regenerate them (saves minutes of CPU on 500+ obs).
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  UnsupportedEmbeddingModalityError,
  validateEmbeddingInput,
  type EmbeddingInput,
  type EmbeddingModality,
  type EmbeddingOptions,
  type EmbeddingProvider,
} from './provider.js';

const CACHE_DIR = process.env.MEMORIX_DATA_DIR || join(homedir(), '.memorix', 'data');
const CACHE_FILE = join(CACHE_DIR, '.embedding-cache.json');

// In-memory cache keyed by text hash → embedding
const cache = new Map<string, number[]>();
const MAX_CACHE_SIZE = 5000;
const DEFAULT_CACHE_PAYLOAD_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_FILE_BYTES = 128 * 1024 * 1024;
let cachePayloadBytes = 0;
let diskCacheDirty = false;

function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

async function loadDiskCache(): Promise<void> {
  try {
    const raw = await readFile(CACHE_FILE, 'utf-8');
    if (Buffer.byteLength(raw, 'utf8') > MAX_CACHE_FILE_BYTES) {
      console.error('[memorix] FastEmbed cache exceeds the disk load limit; starting with an empty cache');
      return;
    }
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !isVector(entry[1])) continue;
      cacheSet(entry[0], entry[1], false);
    }
    console.error(`[memorix] Loaded ${cache.size} cached embeddings from disk`);
  } catch {
    // No cache file or corrupt — start fresh
  }
}

function isVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number');
}

function maxCachePayloadBytes(): number {
  const raw = Number.parseInt(process.env.MEMORIX_EMBEDDING_CACHE_MAX_BYTES ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CACHE_PAYLOAD_BYTES;
}

function cacheSet(hash: string, value: number[], markDirty = true): void {
  const incomingBytes = value.length * 8;
  if (incomingBytes > maxCachePayloadBytes()) return;
  const existing = cache.get(hash);
  if (existing) cachePayloadBytes -= existing.length * 8;
  else {
    while (
      cache.size >= MAX_CACHE_SIZE
      || cachePayloadBytes + incomingBytes > maxCachePayloadBytes()
    ) {
      const firstKey = cache.keys().next().value;
      if (firstKey === undefined) break;
      const old = cache.get(firstKey);
      cache.delete(firstKey);
      if (old) cachePayloadBytes -= old.length * 8;
    }
  }
  cache.set(hash, value);
  cachePayloadBytes += incomingBytes;
  if (markDirty) diskCacheDirty = true;
}

async function saveDiskCache(): Promise<void> {
  if (!diskCacheDirty) return;
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const entries = Array.from(cache.entries());
    await writeFile(CACHE_FILE, JSON.stringify(entries));
    diskCacheDirty = false;
  } catch {
    // Ignore write errors — cache is an optimization, not critical
  }
}

export class FastEmbedProvider implements EmbeddingProvider {
  readonly name = 'fastembed-bge-small';
  readonly dimensions = 384;
  readonly supportedModalities: readonly EmbeddingModality[] = ['text'];

  private model: { embed: (docs: string[], batchSize?: number) => AsyncGenerator<number[][]>; queryEmbed: (query: string) => Promise<number[]> };

  private constructor(model: FastEmbedProvider['model']) {
    this.model = model;
  }

  /**
   * Initialize the FastEmbed provider.
   * Downloads model on first use (~30MB), cached locally after.
   * Loads persistent embedding cache from disk.
   */
  static async create(): Promise<FastEmbedProvider> {
    // Dynamic import — throws if fastembed is not installed
    const { EmbeddingModel, FlagEmbedding } = await import('fastembed');
    const model = await FlagEmbedding.init({
      model: EmbeddingModel.BGESmallENV15,
    });
    // Load disk cache before returning — subsequent embedBatch calls will hit cache
    await loadDiskCache();
    return new FastEmbedProvider(model);
  }

  async embedInput(input: EmbeddingInput, _options: EmbeddingOptions = {}): Promise<number[]> {
    validateEmbeddingInput(input);
    if (input.modality !== 'text') {
      throw new UnsupportedEmbeddingModalityError(this.name, input.modality);
    }
    return this.embed(input.text);
  }

  async embedInputs(inputs: EmbeddingInput[], options: EmbeddingOptions = {}): Promise<number[][]> {
    return Promise.all(inputs.map((input) => this.embedInput(input, options)));
  }

  async embed(text: string): Promise<number[]> {
    const hash = textHash(text);
    const cached = cache.get(hash);
    if (cached) return cached;

    const raw = await this.model.queryEmbed(text);
    // Ensure plain number[] (fastembed may return Float32Array)
    const result = Array.from(raw) as number[];
    if (result.length !== this.dimensions) {
      throw new Error(`Expected ${this.dimensions}d embedding, got ${result.length}d`);
    }
    cacheSet(hash, result);
    return result;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = new Array(texts.length);
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    // Check cache for each text (by hash)
    for (let i = 0; i < texts.length; i++) {
      const hash = textHash(texts[i]);
      const cached = cache.get(hash);
      if (cached) {
        results[i] = cached;
      } else {
        uncachedIndices.push(i);
        uncachedTexts.push(texts[i]);
      }
    }

    // Batch embed uncached texts
    if (uncachedTexts.length > 0) {
      console.error(`[memorix] Embedding ${uncachedTexts.length}/${texts.length} uncached texts (${texts.length - uncachedTexts.length} from cache)`);
      let batchIdx = 0;
      for await (const batch of this.model.embed(uncachedTexts, 64)) {
        for (const vec of batch) {
          const originalIdx = uncachedIndices[batchIdx];
          const plain = Array.from(vec) as number[];
          results[originalIdx] = plain;
          cacheSet(textHash(uncachedTexts[batchIdx]), plain);
          batchIdx++;
        }
      }
      // Persist cache to disk after batch operations
      await saveDiskCache();
    }

    return results;
  }

}
