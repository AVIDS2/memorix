/**
 * Transformers.js Provider
 *
 * Pure JavaScript embedding using @huggingface/transformers (HuggingFace).
 * Model: Xenova/all-MiniLM-L6-v2 (384 dimensions, ~22MB quantized)
 *
 * Key advantages over fastembed:
 *   - No native ONNX binding required (pure JS / WASM)
 *   - Works out-of-the-box on Windows, macOS, Linux
 *   - Supports quantized models (q8, q4) for smaller footprint
 *
 * This is an optional dependency — if @huggingface/transformers is not
 * installed, the provider module gracefully falls back to the next option.
 *
 * Inspired by Mem0's multi-provider embedding architecture.
 */
import type { EmbeddingProvider } from './provider.js';
export declare class TransformersProvider implements EmbeddingProvider {
    readonly name = "transformers-minilm";
    readonly dimensions = 384;
    private extractor;
    private constructor();
    /**
     * Initialize the Transformers.js provider.
     * Downloads model on first use (~22MB quantized), cached locally after.
     */
    static create(): Promise<TransformersProvider>;
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
    private cacheSet;
}
//# sourceMappingURL=transformers-provider.d.ts.map