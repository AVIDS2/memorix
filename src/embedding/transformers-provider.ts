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

import {
  UnsupportedEmbeddingModalityError,
  validateEmbeddingInput,
  type EmbeddingInput,
  type EmbeddingOptions,
  type EmbeddingProvider,
} from './provider.js';

// In-memory LRU cache
const cache = new Map<string, number[]>();
const MAX_CACHE_SIZE = 5000;

export class TransformersProvider implements EmbeddingProvider {
    readonly name = 'transformers-minilm';
    readonly dimensions = 384;

    private extractor: any; // Pipeline instance

    private constructor(extractor: any) {
        this.extractor = extractor;
    }

    /**
     * Initialize the Transformers.js provider.
     * Downloads model on first use (~22MB quantized), cached locally after.
     */
    static async create(): Promise<TransformersProvider> {
        // Dynamic import — throws if @huggingface/transformers is not installed
        const { pipeline } = await import('@huggingface/transformers');
        const extractor = await pipeline(
            'feature-extraction',
            'Xenova/all-MiniLM-L6-v2',
            { dtype: 'q8' }, // Quantized for small footprint
        );
        return new TransformersProvider(extractor);
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
        // Check cache first
        const cached = cache.get(text);
        if (cached) return cached;

        const output = await this.extractor(text, {
            pooling: 'mean',
            normalize: true,
        });

        // output.tolist() returns [[...384 floats]]
        const result: number[] = Array.from(output.tolist()[0]);
        if (result.length !== this.dimensions) {
            throw new Error(`Expected ${this.dimensions}d embedding, got ${result.length}d`);
        }

        this.cacheSet(text, result);
        return result;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        const results: number[][] = new Array(texts.length);
        const uncachedIndices: number[] = [];
        const uncachedTexts: string[] = [];

        // Check cache for each text
        for (let i = 0; i < texts.length; i++) {
            const cached = cache.get(texts[i]);
            if (cached) {
                results[i] = cached;
            } else {
                uncachedIndices.push(i);
                uncachedTexts.push(texts[i]);
            }
        }

        // Batch embed uncached texts
        if (uncachedTexts.length > 0) {
            const output = await this.extractor(uncachedTexts, {
                pooling: 'mean',
                normalize: true,
            });
            const allVecs: number[][] = output.tolist();

            for (let i = 0; i < allVecs.length; i++) {
                const vec = Array.from(allVecs[i]) as number[];
                const originalIdx = uncachedIndices[i];
                results[originalIdx] = vec;
                this.cacheSet(uncachedTexts[i], vec);
            }
        }

        return results;
    }

    private cacheSet(key: string, value: number[]): void {
        if (cache.size >= MAX_CACHE_SIZE) {
            const firstKey = cache.keys().next().value;
            if (firstKey !== undefined) cache.delete(firstKey);
        }
        cache.set(key, value);
    }
}
