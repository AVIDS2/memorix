/**
 * Unified Configuration Reader
 *
 * Priority chain (highest wins):
 *   1. Environment variables (from MCP JSON `env` field or system env)
 *   2. memorix.yml (project-level ./memorix.yml > user-level ~/.memorix/memorix.yml)
 *   3. ~/.memorix/config.json (legacy, written by `memorix configure` TUI)
 *   4. Hardcoded defaults
 *
 * This ensures both YAML platform config and TUI config take effect,
 * while env vars can still override for advanced users.
 */
import { type MemorixYamlConfig } from './config/yaml-loader.js';
export { loadDotenv, resetDotenv, getLoadedEnvFiles } from './config/dotenv-loader.js';
export interface MemorixConfig {
    llm?: {
        provider?: string;
        apiKey?: string;
        model?: string;
        baseUrl?: string;
    };
    agent?: {
        provider?: string;
        apiKey?: string;
        model?: string;
        baseUrl?: string;
    };
    embedding?: string;
    embeddingApi?: {
        apiKey?: string;
        baseUrl?: string;
        model?: string;
        dimensions?: number;
    };
}
/**
 * Load config from ~/.memorix/config.json.
 * Cached after first load. Returns empty object on failure.
 */
export declare function loadFileConfig(): MemorixConfig;
/**
 * Reset cached config (for testing).
 */
export declare function resetConfigCache(): void;
/** LLM API key: env > memorix.yml > config.json > generic env fallbacks */
export declare function getLLMApiKey(): string | undefined;
/** LLM provider: env > memorix.yml > config.json > auto-detect */
export declare function getLLMProvider(): string;
/** LLM model: env > memorix.yml > config.json > provider default */
export declare function getLLMModel(providerDefault: string): string;
/** LLM base URL: env > memorix.yml > config.json > provider default */
export declare function getLLMBaseUrl(providerDefault: string): string;
/** TUI/chat agent LLM API key: agent env > agent config > memory LLM fallback */
export declare function getAgentLLMApiKey(): string | undefined;
/** TUI/chat agent LLM provider: agent env > agent config > memory LLM fallback */
export declare function getAgentLLMProvider(): string;
/** TUI/chat agent LLM model: agent env > agent config > memory LLM fallback */
export declare function getAgentLLMModel(providerDefault: string): string;
/** TUI/chat agent LLM base URL: agent env > agent config > memory LLM fallback */
export declare function getAgentLLMBaseUrl(providerDefault: string): string;
/** Embedding mode: env > memorix.yml > config.json > 'off' */
export declare function getEmbeddingMode(): 'off' | 'fastembed' | 'transformers' | 'api' | 'auto';
/** Embedding API key: env > memorix.yml > config.json > LLM key fallback */
export declare function getEmbeddingApiKey(): string | undefined;
/** Embedding base URL: env > memorix.yml > config.json > LLM URL fallback */
export declare function getEmbeddingBaseUrl(): string;
/** Embedding model: env > memorix.yml > config.json > default */
export declare function getEmbeddingModel(): string;
/** Embedding dimensions override: env > memorix.yml > config.json > null (auto-detect) */
export declare function getEmbeddingDimensions(): number | null;
/** Git-Memory pipeline config */
export declare function getGitConfig(): NonNullable<MemorixYamlConfig['git']>;
/** Server config */
export declare function getServerConfig(): NonNullable<MemorixYamlConfig['server']>;
/** Team config */
export declare function getTeamConfig(): NonNullable<MemorixYamlConfig['team']>;
/** Get the full resolved YAML config (for status display) */
export { loadYamlConfig } from './config/yaml-loader.js';
//# sourceMappingURL=config.d.ts.map