/**
 * API Embedding Provider
 *
 * Remote embedding via any OpenAI-compatible /v1/embeddings endpoint.
 * Works with OpenAI, DashScope/Qwen, Ollama-compatible gateways, and similar providers.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, constants as fsConstants } from 'node:fs';
import { access, readFile, writeFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import {
  EmbeddingInputError,
  UnsupportedEmbeddingModalityError,
  validateEmbeddingInput,
  type EmbeddingInput,
  type EmbeddingModality,
  type EmbeddingOptions,
  type EmbeddingProvider,
  type EmbeddingRequestOptions,
} from './provider.js';

function cacheDir(): string {
  return process.env.MEMORIX_DATA_DIR || join(homedir(), '.memorix', 'data');
}
function cacheFile(): string {
  return join(cacheDir(), '.embedding-api-cache.json');
}
function cacheJsonlFile(): string {
  return join(cacheDir(), '.embedding-api-cache.jsonl');
}
function dimsCacheFile(): string {
  return join(cacheDir(), '.embedding-dims-cache.json');
}
function cacheMetaFile(): string {
  return join(cacheDir(), '.embedding-api-cache-meta.json');
}
function cacheStatFile(): string {
  return join(cacheDir(), '.embedding-api-cache-stat.json');
}

const cache = new Map<string, number[]>();
/** Hard entry ceiling. The real load cap is dimension-aware payload bytes. */
const MAX_CACHE_ENTRIES = 200000;
/** 256 MiB of Float64 payload. 4096d × 8 bytes → 8,192 entries, not 200k. */
const MAX_CACHE_PAYLOAD_BYTES = 256 * 1024 * 1024;
const BYTES_PER_DIM = 8;
const DEFAULT_ASSUMED_DIMENSIONS = 4096;
const MAX_MIGRATION_VALUE_BYTES = 16 * 1024 * 1024;

let cachePayloadBytes = 0;
let cacheDimensions: number | null = null;
let diskCacheEntryCount = 0;
let diskCacheDirty = false;
let diskSaveTimer: ReturnType<typeof setTimeout> | null = null;
let diskCacheLoaded = false;
let diskCacheLoadPromise: Promise<void> | null = null;
let diskCacheLoadCount = 0;
let jsonlLineCountCalls = 0;

interface CacheStat {
  version: 1;
  entryCount: number;
  dimensions: number | null;
}

function payloadBytes(vector: number[]): number {
  return vector.length * BYTES_PER_DIM;
}

function maxCachePayloadBytes(): number {
  const raw = process.env.MEMORIX_EMBEDDING_CACHE_MAX_BYTES;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return MAX_CACHE_PAYLOAD_BYTES;
}

function maxEntriesForDimensions(dimensions: number): number {
  const dim = Math.max(1, Math.floor(dimensions));
  const byBytes = Math.floor(maxCachePayloadBytes() / (dim * BYTES_PER_DIM));
  return Math.max(1, Math.min(MAX_CACHE_ENTRIES, byBytes));
}

function rememberDimensions(vector: number[]): void {
  if (vector.length > 0 && (cacheDimensions === null || vector.length > cacheDimensions)) {
    cacheDimensions = vector.length;
  }
}

function evictOldest(): void {
  const firstKey = cache.keys().next().value;
  if (firstKey === undefined) return;
  const old = cache.get(firstKey);
  cache.delete(firstKey);
  if (old) cachePayloadBytes -= payloadBytes(old);
}

function evictToFit(incomingBytes: number, incomingDims: number): void {
  const limit = maxEntriesForDimensions(incomingDims);
  while (
    cache.size > 0 &&
    (cache.size >= limit || cachePayloadBytes + incomingBytes > maxCachePayloadBytes())
  ) {
    evictOldest();
  }
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry): entry is number => typeof entry === 'number');
}

function parseCacheRow(raw: unknown): { hash: string; vector: number[] } | null {
  if (Array.isArray(raw)) {
    const hash = raw[0];
    const vector = raw[1];
    if (typeof hash === 'string' && isNumberArray(vector)) {
      return { hash, vector };
    }
    return null;
  }
  if (raw && typeof raw === 'object') {
    const row = raw as { h?: unknown; v?: unknown };
    if (typeof row.h === 'string' && isNumberArray(row.v)) {
      return { hash: row.h, vector: row.v };
    }
  }
  return null;
}

function cacheInsert(hash: string, value: number[], dirty: boolean): void {
  rememberDimensions(value);
  const incoming = payloadBytes(value);
  const existing = cache.get(hash);
  if (existing) {
    cachePayloadBytes -= payloadBytes(existing);
    cache.delete(hash);
  }
  evictToFit(incoming, value.length || cacheDimensions || DEFAULT_ASSUMED_DIMENSIONS);
  cache.set(hash, value);
  cachePayloadBytes += incoming;
  if (dirty) diskCacheDirty = true;
}

async function readCacheStat(): Promise<CacheStat | null> {
  try {
    const data = JSON.parse(await readFile(cacheStatFile(), 'utf-8')) as Partial<CacheStat>;
    if (typeof data.entryCount === 'number' && Number.isFinite(data.entryCount) && data.entryCount >= 0) {
      return {
        version: 1,
        entryCount: Math.floor(data.entryCount),
        dimensions: isValidDimension(data.dimensions) ? data.dimensions : null,
      };
    }
  } catch {
    // Stat is an acceleration sidecar, not the source of truth for vectors.
  }
  return null;
}

async function writeCacheStat(stat: CacheStat): Promise<void> {
  try {
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(cacheStatFile(), JSON.stringify(stat));
  } catch {
    // Best-effort sidecar.
  }
}

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

function inputIdentity(input: EmbeddingInput, options: EmbeddingOptions = {}): string {
  return JSON.stringify({
    modality: input.modality,
    input,
    intent: options.intent ?? 'document',
    instruction: options.instruction ?? '',
  });
}

function isJinaEndpoint(baseUrl: string): boolean {
  return /jina\.ai/i.test(baseUrl);
}

function isGoogleEmbeddingEndpoint(baseUrl: string): boolean {
  return /generativelanguage\.googleapis\.com/i.test(baseUrl);
}

function isNativeGeminiEndpoint(baseUrl: string): boolean {
  if (!isGoogleEmbeddingEndpoint(baseUrl)) return false;
  return !new URL(baseUrl).pathname.split('/').includes('openai');
}

function geminiModelName(model: string): string {
  return model.replace(/^models\//, '');
}

function geminiBody(
  input: EmbeddingInput,
  model: string,
  requestedDimensions: number | null,
  options: EmbeddingOptions = {},
): Record<string, unknown> {
  if (options.instruction) {
    throw new EmbeddingInputError(`Gemini native ${model} does not support embedding instructions`);
  }
  if (input.modality !== 'text' && !('data' in input && input.data !== undefined)) {
    throw new UnsupportedEmbeddingModalityError(`Gemini native ${model}`, input.modality);
  }
  const part = input.modality === 'text'
    ? { text: input.text }
    : { inlineData: { mimeType: input.mimeType, data: input.data } };
  const body: Record<string, unknown> = {
    content: { parts: [part] },
  };
  if (requestedDimensions) body.outputDimensionality = requestedDimensions;
  if (!/^gemini-embedding-2(?:-|$)/i.test(geminiModelName(model))) {
    body.taskType = (options.intent ?? 'document') === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';
  }
  return body;
}

function geminiUrl(baseUrl: string, model: string): string {
  return `${baseUrl}/models/${geminiModelName(model)}:embedContent`;
}

function mapIntentTask(baseUrl: string, model: string, options: EmbeddingOptions = {}): Record<string, unknown> {
  const intent = options.intent ?? 'document';
  if (isJinaEndpoint(baseUrl)) {
    return { task: intent === 'query' ? 'retrieval.query' : 'retrieval.passage' };
  }
  if (isGoogleEmbeddingEndpoint(baseUrl)) {
    const out: Record<string, unknown> = {
      task_type: intent === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
    };
    if (options.instruction) out.instruction = options.instruction;
    return out;
  }
  return options.instruction ? { instruction: options.instruction } : {};
}

function toProviderInput(input: EmbeddingInput, baseUrl: string): unknown {
  if (input.modality === 'text') {
    return isJinaEndpoint(baseUrl) ? { text: input.text } : input.text;
  }
  if (isJinaEndpoint(baseUrl)) {
    const key = input.modality === 'document' ? 'pdf' : input.modality;
    if ('data' in input && input.data !== undefined) {
      return { [key]: `data:${input.mimeType};base64,${input.data}` };
    }
    return { [key]: input.url };
  }
  // Generic OpenAI-compatible multimodal transport for capable Google-style endpoints.
  if ('data' in input && input.data !== undefined) {
    return { type: input.modality, data: input.data, media_type: input.mimeType };
  }
  return { type: input.modality, url: input.url };
}

/**
 * Parse a large embedding cache off the HTTP event loop.
 * JSON.parse of a 300MB file on the serve-http thread makes /health time out
 * and the LaunchAgent watchdog restart a healthy-but-busy control plane.
 */
export function parseCacheJsonInWorker(filePath: string): Promise<[string, number[]][]> {
  return new Promise((resolve, reject) => {
    void import('node:worker_threads').then(({ Worker }) => {
      const worker = new Worker(
        `
        const { parentPort, workerData } = require('node:worker_threads');
        const { readFileSync } = require('node:fs');
        try {
          const raw = readFileSync(workerData.filePath, 'utf8');
          parentPort.postMessage({ ok: true, entries: JSON.parse(raw) });
        } catch (err) {
          parentPort.postMessage({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        `,
        { eval: true, workerData: { filePath } },
      );
      worker.once('message', (msg: { ok?: boolean; entries?: [string, number[]][]; error?: string }) => {
        void worker.terminate();
        if (msg?.ok && Array.isArray(msg.entries)) {
          resolve(msg.entries);
          return;
        }
        reject(new Error(msg?.error || 'embedding cache worker parse failed'));
      });
      worker.once('error', reject);
    }).catch(reject);
  });
}

function findJsonValueEnd(source: string): number {
  let i = 0;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  if (i >= source.length) return -1;
  const start = source[i];
  if (start === '"') {
    i += 1;
    while (i < source.length) {
      if (source[i] === '\\') {
        i += 2;
        continue;
      }
      if (source[i] === '"') return i + 1;
      i += 1;
    }
    return -1;
  }
  if (start === '{' || start === '[') {
    const close = start === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (inString) {
        if (ch === '\\') {
          i += 1;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === start) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  }
  const rest = source.slice(i);
  const match = rest.match(/^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/);
  return match ? i + match[0].length : -1;
}

async function streamJsonArrayToJsonl(filePath: string, tmpPath: string): Promise<number> {
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const out = createWriteStream(tmpPath);
  let buf = '';
  let started = false;
  let count = 0;
  const writeLine = async (line: string): Promise<void> => {
    if (!out.write(line)) {
      await new Promise<void>((resolve, reject) => {
        out.once('drain', resolve);
        out.once('error', reject);
      });
    }
  };

  try {
    for await (const chunk of input) {
      buf += chunk;
      if (!started) {
        const idx = buf.search(/\S/);
        if (idx < 0) continue;
        if (buf[idx] !== '[') throw new Error('embedding cache is not a JSON array');
        buf = buf.slice(idx + 1);
        started = true;
      }
      while (true) {
        buf = buf.replace(/^\s*,?\s*/, '');
        if (!buf) break;
        if (buf[0] === ']') {
          buf = '';
          break;
        }
        const end = findJsonValueEnd(buf);
        if (end < 0) break;
        const value = JSON.parse(buf.slice(0, end));
        buf = buf.slice(end);
        const row = parseCacheRow(value);
        if (row) {
          await writeLine(`${JSON.stringify({ h: row.hash, v: row.vector })}\n`);
          count += 1;
          if (count % 50 === 0) {
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
        }
      }
      if (buf.length > MAX_MIGRATION_VALUE_BYTES) {
        throw new Error('embedding cache entry too large to migrate safely');
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve());
      out.once('error', reject);
    });
  }
  return count;
}

/**
 * Convert a JSON-array cache to JSONL with one-entry-at-a-time parsing,
 * a temp file, and an atomic rename. The HTTP process never holds the full
 * array plus a lines[] copy.
 */
export async function migrateJsonArrayCacheToJsonl(filePath: string, jsonlPath: string): Promise<number> {
  const tmpPath = `${jsonlPath}.tmp`;
  try {
    const count = await streamJsonArrayToJsonl(filePath, tmpPath);
    await rename(tmpPath, jsonlPath);
    diskCacheEntryCount = count;
    await writeCacheStat({
      version: 1,
      entryCount: count,
      dimensions: cacheDimensions,
    });
    return count;
  } catch (err) {
    await unlink(tmpPath).catch(() => undefined);
    throw err;
  }
}

/**
 * Convert a giant JSON-array cache to JSONL on disk. Never postMessage the
 * vectors — structured clone of 27k×1024 floats OOMs the HTTP process and
 * the subsequent empty save overwrites the real cache.
 */
export function convertArrayCacheToJsonl(filePath: string, jsonlPath: string): Promise<number> {
  return migrateJsonArrayCacheToJsonl(filePath, jsonlPath);
}

async function loadCacheJsonl(filePath: string): Promise<number> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let loaded = 0;
  let onDiskCount = 0;
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = parseCacheRow(JSON.parse(trimmed));
      if (!row) continue;
      onDiskCount += 1;
      cacheInsert(row.hash, row.vector, false);
      loaded = cache.size;
    } catch {
      // Skip a corrupt line; the rest of the cache remains usable.
    }
    if (onDiskCount % 250 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  diskCacheEntryCount = onDiskCount;
  await writeCacheStat({
    version: 1,
    entryCount: onDiskCount,
    dimensions: cacheDimensions,
  });
  return loaded;
}

async function countJsonlLines(filePath: string): Promise<number> {
  jsonlLineCountCalls += 1;
  try {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    let count = 0;
    for await (const line of rl) {
      if (line.trim()) count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

async function resolveOnDiskCount(jsonlPath: string): Promise<number> {
  if (diskCacheEntryCount > 0) return diskCacheEntryCount;
  const sidecar = await readCacheStat();
  if (sidecar) {
    diskCacheEntryCount = sidecar.entryCount;
    if (sidecar.dimensions && cacheDimensions === null) cacheDimensions = sidecar.dimensions;
    return sidecar.entryCount;
  }
  try {
    await access(jsonlPath, fsConstants.R_OK);
  } catch {
    return 0;
  }
  // Legacy JSONL without a sidecar: one-time count, then persist so saves stay O(1).
  const counted = await countJsonlLines(jsonlPath);
  diskCacheEntryCount = counted;
  await writeCacheStat({
    version: 1,
    entryCount: counted,
    dimensions: cacheDimensions,
  });
  return counted;
}

async function loadDiskCache(): Promise<number> {
  if (diskCacheLoaded) return cache.size;
  let loaded = 0;
  try {
    const jsonlPath = cacheJsonlFile();
    let hasJsonl = false;
    try {
      await access(jsonlPath, fsConstants.R_OK);
      hasJsonl = true;
    } catch {
      hasJsonl = false;
    }
    if (hasJsonl) {
      loaded = await loadCacheJsonl(jsonlPath);
    } else {
      const filePath = cacheFile();
      await stat(filePath);
      await migrateJsonArrayCacheToJsonl(filePath, jsonlPath);
      loaded = await loadCacheJsonl(jsonlPath);
    }
    diskCacheLoadCount += 1;
    console.error(`[memorix] Loaded ${loaded} cached API embeddings from disk`);
  } catch {
    // No cache file or corrupt cache; start fresh. Never save an empty map
    // over a larger on-disk cache — saveDiskCacheNow refuses that shrink.
  }
  diskCacheLoaded = true;
  return loaded;
}

/** Start loading disk cache in background (non-blocking). */
function startDiskCacheLoad(): void {
  if (diskCacheLoaded || diskCacheLoadPromise) return;
  diskCacheLoadPromise = loadDiskCache().then(() => undefined).catch(() => {});
}

/** Ensure disk cache is loaded (await if still in progress). */
export async function ensureDiskCacheLoaded(): Promise<number> {
  if (diskCacheLoaded) return cache.size;
  if (!diskCacheLoadPromise) {
    diskCacheLoadPromise = loadDiskCache().then(() => undefined).catch(() => {});
  }
  await diskCacheLoadPromise;
  return cache.size;
}

/** @internal How many times the on-disk embedding cache was parsed. */
export function getApiEmbeddingDiskCacheLoadCountForTests(): number {
  return diskCacheLoadCount;
}

/** @internal Reset in-process API embedding cache between tests. */
export function resetApiEmbeddingCacheForTests(): void {
  cache.clear();
  cachePayloadBytes = 0;
  cacheDimensions = null;
  diskCacheEntryCount = 0;
  diskCacheLoaded = false;
  diskCacheLoadPromise = null;
  diskCacheLoadCount = 0;
  diskCacheDirty = false;
  jsonlLineCountCalls = 0;
}

/** @internal Seed the in-memory API embedding cache for shrink-guard tests. */
export function seedApiEmbeddingCacheForTests(entries: Map<string, number[]>): void {
  cache.clear();
  cachePayloadBytes = 0;
  cacheDimensions = null;
  for (const [key, value] of entries) cacheInsert(key, value, true);
  diskCacheLoaded = true;
  diskCacheDirty = true;
}

/** @internal In-memory vector payload bytes retained after load/eviction. */
export function getApiEmbeddingCachePayloadBytesForTests(): number {
  return cachePayloadBytes;
}

/** @internal How many times a full JSONL line scan ran (must stay off the save path). */
export function getApiEmbeddingJsonlLineCountCallsForTests(): number {
  return jsonlLineCountCalls;
}

/** @internal Dimension-aware in-memory entry cap for a vector width. */
export function getApiEmbeddingMaxEntriesForDimensionsForTests(dimensions: number): number {
  return maxEntriesForDimensions(dimensions);
}

function dimsCacheKey(config: Pick<APIEmbeddingConfig, 'baseUrl' | 'model' | 'requestedDimensions'>): string {
  return [
    config.baseUrl.replace(/\/+$/, ''),
    config.model,
    config.requestedDimensions ?? 'native',
  ].join('|');
}

interface CacheMetadataEntry {
  namespace: string;
  dimensions: number;
  ts: number;
}

function isValidDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * The vector cache keeps a tiny, redundant namespace → dimensions map. It lets
 * cache-first startup recover when the separate dimensions cache is missing.
 */
async function loadCachedVectorDimensions(
  config: Pick<APIEmbeddingConfig, 'baseUrl' | 'model' | 'requestedDimensions'>,
): Promise<number | null> {
  try {
    const raw = await readFile(cacheMetaFile(), 'utf-8');
    const data = JSON.parse(raw);
    const namespace = cacheNamespace(config);
    if (!Array.isArray(data?.entries)) return null;
    const entry = data.entries.find((candidate: unknown) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as { namespace?: unknown }).namespace === namespace &&
      isValidDimension((candidate as { dimensions?: unknown }).dimensions),
    ) as CacheMetadataEntry | undefined;
    return entry?.dimensions ?? null;
  } catch {
    return null;
  }
}

async function saveCachedVectorDimensions(
  config: Pick<APIEmbeddingConfig, 'baseUrl' | 'model' | 'requestedDimensions'>,
  dimensions: number,
): Promise<void> {
  if (!isValidDimension(dimensions)) return;
  try {
    await mkdir(cacheDir(), { recursive: true });
    let entries: CacheMetadataEntry[] = [];
    try {
      const raw = await readFile(cacheMetaFile(), 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data?.entries)) {
        entries = data.entries.filter((candidate: unknown): candidate is CacheMetadataEntry =>
          typeof candidate === 'object' &&
          candidate !== null &&
          typeof (candidate as { namespace?: unknown }).namespace === 'string' &&
          isValidDimension((candidate as { dimensions?: unknown }).dimensions) &&
          typeof (candidate as { ts?: unknown }).ts === 'number',
        );
      }
    } catch {
      // The cache metadata is a best-effort acceleration layer.
    }

    const namespace = cacheNamespace(config);
    entries = entries.filter((entry) => entry.namespace !== namespace);
    entries.push({ namespace, dimensions, ts: Date.now() });
    await writeFile(cacheMetaFile(), JSON.stringify({ version: 1, entries }));
  } catch {
    // A missing or read-only cache must never block embedding requests.
  }
}

/** Load cached probe dimensions from disk. Returns null if not cached. */
async function loadCachedDims(config: Pick<APIEmbeddingConfig, 'baseUrl' | 'model' | 'requestedDimensions'>): Promise<number | null> {
  try {
    const raw = await readFile(dimsCacheFile(), 'utf-8');
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
    await mkdir(cacheDir(), { recursive: true });
    const key = dimsCacheKey(config);
    let entries: Array<{ key: string; baseUrl: string; model: string; requestedDimensions: number | null; dimensions: number; ts: number }> = [];

    try {
      const raw = await readFile(dimsCacheFile(), 'utf-8');
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

    await writeFile(dimsCacheFile(), JSON.stringify({ entries }));
  } catch { /* best-effort */ }
  await saveCachedVectorDimensions(config, dimensions);
}

export async function saveDiskCacheNow(): Promise<void> {
  if (!diskCacheDirty) return;
  try {
    await mkdir(cacheDir(), { recursive: true });
    const jsonlPath = cacheJsonlFile();
    const existing = await resolveOnDiskCount(jsonlPath);
    if (existing > 0 && cache.size < Math.ceil(existing * 0.5)) {
      console.error(
        `[memorix] Refusing to overwrite embedding cache (${existing} on disk vs ${cache.size} in memory)`,
      );
      diskCacheDirty = false;
      return;
    }
    const tmpPath = `${jsonlPath}.tmp`;
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(tmpPath);
      const entries = cache.entries();
      const writeBatch = (): void => {
        for (let i = 0; i < 50; i++) {
          const next = entries.next();
          if (next.done) {
            out.end();
            return;
          }
          const [hash, vector] = next.value;
          if (!out.write(`${JSON.stringify({ h: hash, v: vector })}\n`)) {
            out.once('drain', writeBatch);
            return;
          }
        }
        setImmediate(writeBatch);
      };
      out.on('finish', resolve);
      out.on('error', reject);
      writeBatch();
    });
    await rename(tmpPath, jsonlPath);
    diskCacheEntryCount = cache.size;
    await writeCacheStat({
      version: 1,
      entryCount: cache.size,
      dimensions: cacheDimensions,
    });
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
  cacheInsert(hash, value, true);
}

interface EmbeddingAPIResponse {
  object?: string;
  embedding?: { values: number[] };
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

class EmbeddingAPIError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`Embedding API error (${status}): ${detail}`);
    this.name = 'EmbeddingAPIError';
    this.status = status;
  }
}

export interface APIEmbeddingProviderCreateOptions {
  /**
   * When false, only previously persisted dimension metadata may initialize
   * the provider. This keeps startup/cache hydration off the remote API path.
   */
  allowNetworkProbe?: boolean;
  /** Bound the one-off remote dimension probe used on a cold API start. */
  requestTimeoutMs?: number;
  /** Disable retries for a bounded, best-effort API initialization. */
  retry?: boolean;
}

function resolveEnvEmbeddingApiKey(): string | undefined {
  return process.env.MEMORIX_EMBEDDING_API_KEY;
}

function getPreferredBatchSize(config: APIEmbeddingConfig): number {
  if (/dashscope\.aliyuncs\.com/i.test(config.baseUrl)) {
    return DASHSCOPE_MAX_BATCH_SIZE;
  }
  return DEFAULT_MAX_BATCH_SIZE;
}

function parseBatchLimit(error: unknown): number | null {
  if (!(error instanceof Error)) return null;

  // Only a provider-side request-shape error may trigger recursive batch
  // splitting. Billing, authentication, quota, and upstream errors must fail
  // once; retrying them multiplies latency without changing the request.
  const status = error instanceof EmbeddingAPIError
    ? error.status
    : Number(error.message.match(/Embedding API error \((\d{3})\)/i)?.[1] ?? 0);
  if (status > 0 && status !== 400) return null;

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
  readonly supportedModalities: readonly EmbeddingModality[];

  private config: APIEmbeddingConfig;
  private readonly cacheKeyNamespace: string;
  private totalTokensUsed = 0;
  private totalApiCalls = 0;

  private constructor(config: APIEmbeddingConfig, detectedDimensions: number) {
    this.config = config;
    this.cacheKeyNamespace = cacheNamespace(config);
    this.dimensions = detectedDimensions;
    this.name = `api-${config.model.replace(/\//g, '-')}`;
    this.supportedModalities = isJinaEndpoint(config.baseUrl)
      ? ['text', 'image', 'audio', 'video', 'document']
      : isNativeGeminiEndpoint(config.baseUrl) && /embedding-2/i.test(config.model)
        ? ['text', 'image', 'audio', 'video', 'document']
        : ['text'];
  }

  static async create(): Promise<APIEmbeddingProvider>;
  static async create(options: APIEmbeddingProviderCreateOptions & { allowNetworkProbe: false }): Promise<APIEmbeddingProvider | null>;
  static async create(options: APIEmbeddingProviderCreateOptions): Promise<APIEmbeddingProvider | null>;
  static async create(options: APIEmbeddingProviderCreateOptions = {}): Promise<APIEmbeddingProvider | null> {
    const config = APIEmbeddingProvider.resolveConfig();
    const allowNetworkProbe = options.allowNetworkProbe !== false;

    // Try cached dimensions first to avoid a network probe on cold start
    let probeDimensions = await loadCachedDims(config);
    let dimensionSource: 'dims-cache' | 'vector-cache' | 'probe' = 'dims-cache';
    if (probeDimensions === null) {
      probeDimensions = await loadCachedVectorDimensions(config);
      if (probeDimensions !== null) dimensionSource = 'vector-cache';
    }
    if (probeDimensions !== null) {
      console.error(`[memorix] API embedding: ${config.model} @ ${config.baseUrl} (${probeDimensions}d) [${dimensionSource}]`);
      if (dimensionSource === 'dims-cache') {
        void saveCachedVectorDimensions(config, probeDimensions);
      }
    } else {
      if (!allowNetworkProbe) return null;
      probeDimensions = await APIEmbeddingProvider.probeAPI(config, {
        timeoutMs: options.requestTimeoutMs,
        retry: options.retry,
      });
      console.error(`[memorix] API embedding: ${config.model} @ ${config.baseUrl} (${probeDimensions}d)`);
      // Persist for next cold start
      saveCachedDims(config, probeDimensions).catch(() => {});
    }
    if (config.requestedDimensions) {
      console.error(`[memorix] Dimension shortening: ${config.requestedDimensions}d requested`);
    }

    // Startup / CLI lexical lanes pass allowNetworkProbe=false. Do not begin
    // the 300MB JSONL parse here — that keeps one-shot CLI processes alive
    // after search already printed. getCachedEmbeddings() still loads the
    // cache when a later hybrid/attach path actually needs vectors.
    if (allowNetworkProbe) {
      startDiskCacheLoad();
    }

    return new APIEmbeddingProvider(config, probeDimensions);
  }

  private static resolveConfig(): APIEmbeddingConfig {
    let apiKey: string | undefined;
    let baseUrl: string;
    let model: string;
    let requestedDimensions: number | null;

    try {
      let cfg: {
        getEmbeddingApiKey: () => string | undefined;
        getEmbeddingBaseUrl: () => string;
        getEmbeddingModel: () => string;
        getEmbeddingDimensions: () => number | null;
      };
      try {
        cfg = require('../config.ts');
      } catch {
        cfg = require('../config.js');
      }
      baseUrl = cfg.getEmbeddingBaseUrl();
      apiKey = cfg.getEmbeddingApiKey();
      model = cfg.getEmbeddingModel();
      requestedDimensions = cfg.getEmbeddingDimensions();
    } catch {
      baseUrl =
        process.env.MEMORIX_EMBEDDING_BASE_URL ||
        'https://api.openai.com/v1';
      apiKey = resolveEnvEmbeddingApiKey();
      model = process.env.MEMORIX_EMBEDDING_MODEL || 'text-embedding-3-small';
      const dimStr = process.env.MEMORIX_EMBEDDING_DIMENSIONS;
      requestedDimensions = dimStr ? parseInt(dimStr, 10) : null;
    }

    if (!apiKey) {
      throw new Error(
        'No API key for embedding. Set MEMORIX_EMBEDDING_API_KEY or configure embedding.apiKey in memorix.yml / ~/.memorix/config.json.',
      );
    }

    baseUrl = baseUrl.replace(/\/+$/, '');

    return { apiKey, baseUrl, model, requestedDimensions };
  }

  private static async probeAPI(config: APIEmbeddingConfig, options?: EmbeddingRequestOptions): Promise<number> {
    if (isNativeGeminiEndpoint(config.baseUrl)) {
      const response = await fetchWithRetry(
        geminiUrl(config.baseUrl, config.model),
        config.apiKey,
        geminiBody({ modality: 'text', text: 'dimension probe' }, config.model, config.requestedDimensions),
        options,
        0,
        true,
      );
      const embedding = response.embedding?.values;
      if (!embedding) throw new Error('API probe returned no embeddings; check model name and API key');
      return embedding.length;
    }
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
      options,
    );

    const embedding = response.data?.[0]?.embedding;
    if (!embedding) throw new Error('API probe returned no embeddings; check model name and API key');
    return embedding.length;
  }

  async embed(text: string, options?: EmbeddingRequestOptions): Promise<number[]> {
    const normalized = normalizeText(text);
    if (isNativeGeminiEndpoint(this.config.baseUrl)) {
      return this.embedInput({ modality: 'text', text: normalized }, { intent: 'document', ...options });
    }
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
        options,
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

  async embedBatch(texts: string[], options?: EmbeddingRequestOptions): Promise<number[][]> {
    if (isNativeGeminiEndpoint(this.config.baseUrl)) {
      return Promise.all(texts.map((text) => this.embedInput({ modality: 'text', text }, { intent: 'document', ...options })));
    }
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
          options,
        );

        this.trackUsage(response);

        for (const item of response.data) {
          const originalIdx = chunkIndices[item.index];
          results[originalIdx] = item.embedding;
          cacheSet(textHash(normalizedTexts[originalIdx], this.cacheKeyNamespace), item.embedding);
        }
      } catch (error) {
        const providerLimit = parseBatchLimit(error);
        if (providerLimit !== null && chunkTexts.length > 1 && providerLimit < chunkTexts.length) {
          console.error(
            `[memorix] Embedding batch too large for provider, retrying in chunks of ${providerLimit}`,
          );
          for (let start = 0; start < chunkTexts.length; start += providerLimit) {
            await processChunk(
              chunkTexts.slice(start, start + providerLimit),
              chunkIndices.slice(start, start + providerLimit),
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

  async getCachedEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
    await ensureDiskCacheLoaded();
    return texts.map((text) => {
      const hash = textHash(normalizeText(text), this.cacheKeyNamespace);
      return cache.get(hash) ?? null;
    });
  }

  private supportsModality(modality: EmbeddingInput['modality']): boolean {
    return this.supportedModalities.includes(modality);
  }

  async embedInput(input: EmbeddingInput, options: EmbeddingOptions = {}): Promise<number[]> {
    validateEmbeddingInput(input);
    if (!this.supportsModality(input.modality)) {
      throw new UnsupportedEmbeddingModalityError(this.name, input.modality);
    }
    if (input.modality === 'text' && !options.intent && !options.instruction && !isJinaEndpoint(this.config.baseUrl) && !isGoogleEmbeddingEndpoint(this.config.baseUrl)) {
      return this.embed(input.text);
    }

    await ensureDiskCacheLoaded();
    const identity = inputIdentity(input, options);
    const hash = textHash(identity, this.cacheKeyNamespace);
    const cached = cache.get(hash);
    if (cached) return cached;

    const nativeGemini = isNativeGeminiEndpoint(this.config.baseUrl);
    const body: Record<string, unknown> = nativeGemini
      ? geminiBody(input, this.config.model, this.config.requestedDimensions, options)
      : {
          model: this.config.model,
          input: input.modality === 'text' && !isJinaEndpoint(this.config.baseUrl)
            ? input.text
            : [toProviderInput(input, this.config.baseUrl)],
          ...mapIntentTask(this.config.baseUrl, this.config.model, options),
          ...(this.config.requestedDimensions ? { dimensions: this.config.requestedDimensions } : {}),
        };

    const response = await fetchWithRetry(
      nativeGemini ? geminiUrl(this.config.baseUrl, this.config.model) : `${this.config.baseUrl}/embeddings`,
      this.config.apiKey,
      body,
      options,
      0,
      nativeGemini,
    );
    const embedding = nativeGemini ? response.embedding?.values : response.data[0]?.embedding;
    if (!embedding) throw new Error('Embedding API returned no vectors');
    if (embedding.length !== this.dimensions) {
      throw new Error(`Expected ${this.dimensions}d, got ${embedding.length}d; dimension mismatch`);
    }
    this.trackUsage(response);
    cacheSet(hash, embedding);
    scheduleDiskSave();
    return embedding;
  }

  async embedInputs(inputs: EmbeddingInput[], options: EmbeddingOptions = {}): Promise<number[][]> {
    const out: number[][] = [];
    for (const input of inputs) out.push(await this.embedInput(input, options));
    return out;
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
  options: EmbeddingRequestOptions = {},
  attempt = 0,
  nativeGemini = false,
): Promise<EmbeddingAPIResponse> {
  const controller = new AbortController();
  const timeoutMs = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
    ? Math.max(100, Math.min(Math.floor(options.timeoutMs), 60_000))
    : 10_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: nativeGemini
        ? { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }
        : { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && (err.name === 'AbortError' || controller.signal.aborted || options.signal?.aborted)) {
      throw new Error(`Embedding API timeout after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  }

  try {
    if (response.ok) {
      return await raceWithAbort(
        response.json() as Promise<EmbeddingAPIResponse>,
        signal,
      );
    }

    if (options.retry !== false && (response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      const retryAfter = response.headers.get('retry-after');
      const parsedRetryAfter = retryAfter ? parseInt(retryAfter, 10) * 1000 : NaN;
      const waitMs = Number.isFinite(parsedRetryAfter) ? parsedRetryAfter : delay;
      console.error(`[memorix] Embedding API ${response.status}, retry ${attempt + 1}/${MAX_RETRIES} in ${waitMs}ms`);
      await waitForRetry(waitMs, options.signal);
      return fetchWithRetry(url, apiKey, body, options, attempt + 1, nativeGemini);
    }

    const errorText = await raceWithAbort(
      response.text().catch(() => 'unknown error'),
      signal,
    );
    throw new EmbeddingAPIError(response.status, errorText);
  } catch (err: unknown) {
    if (err instanceof Error && (err.name === 'AbortError' || controller.signal.aborted || options.signal?.aborted)) {
      throw new Error(`Embedding API timeout after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function abortError(): Error {
  const error = new Error('Embedding API request aborted');
  error.name = 'AbortError';
  return error;
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

async function waitForRetry(waitMs: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    return;
  }
  const abortSignal = signal;
  if (abortSignal.aborted) throw new Error('Embedding API retry aborted');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, waitMs);
    const onAbort = () => {
      clearTimeout(timer);
      abortSignal.removeEventListener('abort', onAbort);
      reject(new Error('Embedding API retry aborted'));
    };
    function done() {
      abortSignal.removeEventListener('abort', onAbort);
      resolve();
    }
    abortSignal.addEventListener('abort', onAbort, { once: true });
  });
}
