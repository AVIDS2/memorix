/**
 * Embedding Provider — Abstraction Layer
 *
 * Extensible embedding interface. **Disabled by default** to minimize resource usage.
 *
 * Environment variable MEMORIX_EMBEDDING controls which provider to use:
 *   - MEMORIX_EMBEDDING=off (default) → no embedding, BM25 fulltext search only (~50MB RAM)
 *   - MEMORIX_EMBEDDING=fastembed     → local ONNX inference (384-dim bge-small, ~300MB RAM)
 *   - MEMORIX_EMBEDDING=transformers  → pure JS WASM inference (384-dim MiniLM, ~500MB RAM)
 *   - MEMORIX_EMBEDDING=api           → remote API via OpenAI-compatible /v1/embeddings (zero local RAM)
 *   - MEMORIX_EMBEDDING=auto          → try fastembed → transformers → off (legacy behavior)
 *
 * API mode env vars (MEMORIX_EMBEDDING=api):
 *   - MEMORIX_EMBEDDING_API_KEY       → API key (fallback: MEMORIX_LLM_API_KEY → OPENAI_API_KEY)
 *   - MEMORIX_EMBEDDING_BASE_URL      → base URL (fallback: MEMORIX_LLM_BASE_URL)
 *   - MEMORIX_EMBEDDING_MODEL         → model (default: text-embedding-3-small)
 *   - MEMORIX_EMBEDDING_DIMENSIONS    → optional dimension override
 *
 * Resource impact of local embedding:
 *   - First load: 90%+ CPU for 5-30 seconds (model initialization)
 *   - Steady state: 300-500MB RAM (model in memory)
 *   - Per-query: 10-50ms CPU (embedding generation)
 *
 * Most users don't need vector search — BM25 fulltext is sufficient for keyword matching.
 * Vector search is useful for semantic similarity (e.g., "auth" matches "authentication").
 *
 * Architecture inspired by Mem0's multi-provider embedding design.
 */

export interface EmbeddingProvider {
  /** Provider name for logging/cache keys */
  readonly name: string;
  /** Vector dimensions (e.g., 384 for bge-small) */
  readonly dimensions: number;
  /** Generate embedding for a single text */
  embed(text: string): Promise<number[]>;
  /** Generate embeddings for multiple texts (batch) */
  embedBatch(texts: string[]): Promise<number[][]>;
}

/** Singleton provider instance (null = not available) */
let provider: EmbeddingProvider | null = null;
let initPromise: Promise<EmbeddingProvider | null> | null = null;

/**
 * Tracks whether the last init attempt resulted in a temporary failure
 * (mode != 'off' but provider returned null). When true, the next
 * getEmbeddingProvider() call will retry instead of returning cached null.
 */
let lastInitWasTemporaryFailure = false;

/**
 * Get configured embedding mode from environment.
 * Default is 'off' to minimize resource usage.
 */
function getEmbeddingMode(): 'off' | 'fastembed' | 'transformers' | 'api' | 'auto' {
  // Unified: env vars > config.json > 'off'
  try {
    const { getEmbeddingMode: cfgMode } = require('../config.js');
    return cfgMode();
  } catch {
    // Fallback if config module not available
    const env = process.env.MEMORIX_EMBEDDING?.toLowerCase()?.trim();
    if (env === 'fastembed' || env === 'transformers' || env === 'api' || env === 'auto') return env;
    return 'off';
  }
}

/** Minimum interval between retry attempts after a temporary failure (ms). */
const RETRY_COOLDOWN_MS = 30_000;
let lastFailureTimestamp = 0;

/**
 * Get the embedding provider. Returns null if disabled or unavailable.
 * Lazy-initialized on first call. Concurrent callers share the same Promise.
 *
 * Recovery semantics:
 *   - mode === 'off'  → permanently null (no retry)
 *   - mode === 'auto' and NO local provider installed → permanently null (no retry)
 *   - provider init failed due to network/API/temp error → retry after cooldown
 *
 * Controlled by MEMORIX_EMBEDDING environment variable (default: off).
 */
export async function getEmbeddingProvider(): Promise<EmbeddingProvider | null> {
  // If we already have a successfully initialized provider, return it immediately
  if (provider) return provider;

  // If a previous attempt failed temporarily, allow retry after cooldown
  if (lastInitWasTemporaryFailure) {
    const elapsed = Date.now() - lastFailureTimestamp;
    if (elapsed < RETRY_COOLDOWN_MS) {
      // Still within cooldown — return cached null without retrying
      return null;
    }
    // Cooldown expired — clear cached promise to allow retry
    initPromise = null;
    lastInitWasTemporaryFailure = false;
  }

  if (initPromise) return initPromise;

  initPromise = (async () => {
    const mode = getEmbeddingMode();

    // Explicit OFF — skip all embedding initialization (permanent, no retry)
    if (mode === 'off') {
      console.error('[memorix] Embedding disabled (MEMORIX_EMBEDDING=off) — using BM25 fulltext search');
      return null;
    }

    // Explicit fastembed
    if (mode === 'fastembed') {
      try {
        const { FastEmbedProvider } = await import('./fastembed-provider.js');
        provider = await FastEmbedProvider.create();
        console.error(`[memorix] Embedding provider: ${provider!.name} (${provider!.dimensions}d)`);
        return provider;
      } catch (e) {
        console.error(`[memorix] Failed to load fastembed: ${e instanceof Error ? e.message : e}`);
        console.error('[memorix] Install with: npm install fastembed');
        return null;
      }
    }

    // Explicit transformers
    if (mode === 'transformers') {
      try {
        const { TransformersProvider } = await import('./transformers-provider.js');
        provider = await TransformersProvider.create();
        console.error(`[memorix] Embedding provider: ${provider!.name} (${provider!.dimensions}d)`);
        return provider;
      } catch (e) {
        console.error(`[memorix] Failed to load transformers: ${e instanceof Error ? e.message : e}`);
        console.error('[memorix] Install with: npm install @huggingface/transformers');
        return null;
      }
    }

    // API mode: remote embedding via OpenAI-compatible endpoint
    if (mode === 'api') {
      try {
        const { APIEmbeddingProvider } = await import('./api-provider.js');
        provider = await APIEmbeddingProvider.create();
        console.error(`[memorix] Embedding provider: ${provider!.name} (${provider!.dimensions}d)`);
        return provider;
      } catch (e) {
        console.error(`[memorix] Failed to init API embedding: ${e instanceof Error ? e.message : e}`);
        return null;
      }
    }

    // Auto mode: try fastembed → transformers → off (legacy behavior)
    try {
      const { FastEmbedProvider } = await import('./fastembed-provider.js');
      provider = await FastEmbedProvider.create();
      console.error(`[memorix] Embedding provider: ${provider!.name} (${provider!.dimensions}d)`);
      return provider;
    } catch {
      // fastembed not installed — try next
    }

    try {
      const { TransformersProvider } = await import('./transformers-provider.js');
      provider = await TransformersProvider.create();
      console.error(`[memorix] Embedding provider: ${provider!.name} (${provider!.dimensions}d)`);
      return provider;
    } catch {
      // transformers not installed — degrade to fulltext
    }

    console.error('[memorix] No embedding provider available — using BM25 fulltext search');
    return null;
  })();

  // After the init promise resolves, decide whether to cache or allow retry
  const result = await initPromise;
  if (result === null && !isEmbeddingExplicitlyDisabled()) {
    // Temporary failure — mark for retry and record timestamp
    const mode = getEmbeddingMode();
    // 'auto' mode with no local providers installed is permanent (not retryable)
    if (mode === 'api' || mode === 'fastembed' || mode === 'transformers') {
      lastInitWasTemporaryFailure = true;
      lastFailureTimestamp = Date.now();
      console.error(`[memorix] Embedding provider temporarily unavailable — will retry after ${RETRY_COOLDOWN_MS / 1000}s`);
    }
    // 'auto' with no providers → permanent null, no retry needed
  }

  return result;
}

/**
 * Check if vector search is available.
 */
export async function isVectorSearchAvailable(): Promise<boolean> {
  const p = await getEmbeddingProvider();
  return p !== null;
}

/**
 * Check if embedding is explicitly disabled by configuration (mode === 'off').
 *
 * When true, there is no provider to backfill from and observations can be
 * safely removed from the vector-missing queue.
 *
 * When false, the provider MAY still be null due to initialization failure,
 * API error, or missing dependencies — in those cases the observation should
 * stay in the backfill queue for later retry.
 */
export function isEmbeddingExplicitlyDisabled(): boolean {
  return getEmbeddingMode() === 'off';
}

/**
 * Reset provider (for testing).
 */
export function resetProvider(): void {
  provider = null;
  initPromise = null;
  lastInitWasTemporaryFailure = false;
  lastFailureTimestamp = 0;
}
