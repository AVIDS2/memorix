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
import type { EmbeddingProvider } from './provider.js';
export declare class FastEmbedProvider implements EmbeddingProvider {
    readonly name = "fastembed-bge-small";
    readonly dimensions = 384;
    private model;
    private constructor();
    /**
     * Initialize the FastEmbed provider.
     * Downloads model on first use (~30MB), cached locally after.
     * Loads persistent embedding cache from disk.
     */
    static create(): Promise<FastEmbedProvider>;
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
    private cacheSet;
}
//# sourceMappingURL=fastembed-provider.d.ts.map