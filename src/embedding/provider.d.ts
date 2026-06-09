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
 *   - MEMORIX_EMBEDDING=auto          → try configured API → fastembed → transformers → off
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
export declare function getEmbeddingProvider(): Promise<EmbeddingProvider | null>;
/**
 * Check if vector search is available.
 */
export declare function isVectorSearchAvailable(): Promise<boolean>;
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
export declare function isEmbeddingExplicitlyDisabled(): boolean;
/**
 * Reset provider (for testing).
 */
export declare function resetProvider(): void;
//# sourceMappingURL=provider.d.ts.map