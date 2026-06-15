/**
 * Unified Configuration Reader
 *
 * Priority chain (highest wins):
 *   1. Environment variables (from MCP JSON `env` field or system env)
 *   2. memorix.toml / ~/.memorix/config.toml
 *   3. memorix.yml / ~/.memorix/memorix.yml compatibility files
 *   4. ~/.memorix/config.json legacy file
 *   5. Hardcoded defaults
 */

import { loadYamlConfig, type MemorixYamlConfig } from './config/yaml-loader.js';
import {
  getResolvedAgentLane,
  getResolvedConfig,
  getResolvedEmbeddingLane,
  getResolvedMemoryLane,
} from './config/resolved-config.js';
export { loadDotenv, resetDotenv, getLoadedEnvFiles } from './config/dotenv-loader.js';
export { loadFileConfig, resetConfigCache, type MemorixConfig } from './config/legacy-loader.js';

// ─── Resolved Getters ────────────────────────────────────────────────

/** Memory/background LLM API key: env > memorix.yml > config.json > provider env fallbacks */
export function getLLMApiKey(): string | undefined {
  return getResolvedMemoryLane().llm.apiKey;
}

/** LLM provider: env > memorix.yml > config.json > auto-detect */
export function getLLMProvider(): string {
  const provider = getResolvedMemoryLane().llm.provider;
  if (provider) return provider;
  // Auto-detect from env var names
  if (process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) return 'anthropic';
  if (process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY) return 'openrouter';
  return 'openai';
}

/** LLM model: env > memorix.yml > config.json > provider default */
export function getLLMModel(providerDefault: string): string {
  return getResolvedMemoryLane().llm.model || providerDefault;
}

/** LLM base URL: env > memorix.yml > config.json > provider default */
export function getLLMBaseUrl(providerDefault: string): string {
  return getResolvedMemoryLane().llm.baseUrl || providerDefault;
}

/** TUI/chat agent API key: agent env > agent config > memory LLM fallback */
export function getAgentLLMApiKey(): string | undefined {
  return getResolvedAgentLane().apiKey;
}

/** TUI/chat agent provider: agent env > agent config > memory LLM fallback */
export function getAgentLLMProvider(): string {
  return getResolvedAgentLane().provider || getLLMProvider();
}

/** TUI/chat agent model: agent env > agent config > memory LLM fallback */
export function getAgentLLMModel(providerDefault: string): string {
  return getResolvedAgentLane().model || getLLMModel(providerDefault);
}

/** TUI/chat agent base URL: agent env > agent config > memory LLM fallback */
export function getAgentLLMBaseUrl(providerDefault: string): string {
  return getResolvedAgentLane().baseUrl || getLLMBaseUrl(providerDefault);
}

/** Embedding mode: env > memorix.yml > config.json > 'off' */
export function getEmbeddingMode(): 'off' | 'fastembed' | 'transformers' | 'api' | 'auto' {
  const provider = getResolvedEmbeddingLane().provider?.toLowerCase()?.trim();
  if (provider === 'fastembed' || provider === 'transformers' || provider === 'api' || provider === 'auto') return provider;
  return 'off';
}

/** Embedding API key: embedding lane only. Do not borrow memory LLM or agent keys. */
export function getEmbeddingApiKey(): string | undefined {
  return getResolvedEmbeddingLane().apiKey;
}

/** Embedding base URL: env > memorix.yml > config.json > provider default */
export function getEmbeddingBaseUrl(): string {
  return getResolvedEmbeddingLane().baseUrl || 'https://api.openai.com/v1';
}

/** Embedding model: env > memorix.yml > config.json > default */
export function getEmbeddingModel(): string {
  return getResolvedEmbeddingLane().model || 'text-embedding-3-small';
}

/** Embedding dimensions override: env > memorix.yml > config.json > null (auto-detect) */
export function getEmbeddingDimensions(): number | null {
  return getResolvedEmbeddingLane().dimensions ?? null;
}

// ─── YAML-specific getters (new config sections) ────────────────────

/** Git-Memory pipeline config */
export function getGitConfig(): NonNullable<MemorixYamlConfig['git']> {
  return loadYamlConfig().git ?? {};
}

/** Server config */
export function getServerConfig(): NonNullable<MemorixYamlConfig['server']> {
  const server = getResolvedConfig().server;
  return {
    transport: server.transport,
    dashboard: server.dashboard,
    dashboardPort: server.dashboardPort,
    port: server.port,
  };
}

/** Team config */
export function getTeamConfig(): NonNullable<MemorixYamlConfig['team']> {
  return loadYamlConfig().team ?? {};
}

/** Get the full resolved YAML config (for status display) */
export { loadYamlConfig } from './config/yaml-loader.js';
