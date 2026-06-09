/**
 * API Embedding Provider
 *
 * Remote embedding via any OpenAI-compatible /v1/embeddings endpoint.
 * Works with OpenAI, DashScope/Qwen, Ollama-compatible gateways, and similar providers.
 */
import type { EmbeddingProvider } from './provider.js';
export declare class APIEmbeddingProvider implements EmbeddingProvider {
    readonly name: string;
    readonly dimensions: number;
    private config;
    private readonly cacheKeyNamespace;
    private totalTokensUsed;
    private totalApiCalls;
    private constructor();
    static create(): Promise<APIEmbeddingProvider>;
    private static resolveConfig;
    private static probeAPI;
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
    getStats(): {
        totalTokens: number;
        totalApiCalls: number;
        cacheSize: number;
    };
    private trackUsage;
}
//# sourceMappingURL=api-provider.d.ts.map