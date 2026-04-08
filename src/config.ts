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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadYamlConfig, type MemorixYamlConfig } from './config/yaml-loader.js';
export { loadDotenv, resetDotenv, getLoadedEnvFiles } from './config/dotenv-loader.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface MemorixConfig {
  llm?: {
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

// ─── Singleton ───────────────────────────────────────────────────────

let cachedConfig: MemorixConfig | null = null;

/**
 * Load config from ~/.memorix/config.json.
 * Cached after first load. Returns empty object on failure.
 */
export function loadFileConfig(): MemorixConfig {
  if (cachedConfig !== null) return cachedConfig;

  const configPath = join(homedir(), '.memorix', 'config.json');
  try {
    if (existsSync(configPath)) {
      cachedConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
      return cachedConfig!;
    }
  } catch {
    // Corrupt or unreadable — ignore
  }
  cachedConfig = {};
  return cachedConfig;
}

/**
 * Reset cached config (for testing).
 */
export function resetConfigCache(): void {
  cachedConfig = null;
}

// ─── Resolved Getters (env > config.json > default) ──────────────────

/** LLM API key: env > memorix.yml > config.json > generic env fallbacks */
export function getLLMApiKey(): string | undefined {
  return (
    process.env.MEMORIX_LLM_API_KEY ||  // LLM-specific (优先级最高)
    process.env.MEMORIX_API_KEY ||  // Unified API key (fallback)
    loadYamlConfig().llm?.apiKey ||
    loadFileConfig().llm?.apiKey ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    undefined
  );
}

/** LLM provider: env > memorix.yml > config.json > auto-detect */
export function getLLMProvider(): string {
  if (process.env.MEMORIX_LLM_PROVIDER) return process.env.MEMORIX_LLM_PROVIDER;
  const yml = loadYamlConfig();
  if (yml.llm?.provider) return yml.llm.provider;
  const cfg = loadFileConfig();
  if (cfg.llm?.provider) return cfg.llm.provider;
  // Auto-detect from env var names
  if (process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) return 'anthropic';
  if (process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY) return 'openrouter';
  return 'openai';
}

/** LLM model: env > memorix.yml > config.json > provider default */
export function getLLMModel(providerDefault: string): string {
  return process.env.MEMORIX_LLM_MODEL || loadYamlConfig().llm?.model || loadFileConfig().llm?.model || providerDefault;
}

/** LLM base URL: env > memorix.yml > config.json > provider default */
export function getLLMBaseUrl(providerDefault: string): string {
  return process.env.MEMORIX_LLM_BASE_URL || loadYamlConfig().llm?.baseUrl || loadFileConfig().llm?.baseUrl || providerDefault;
}

/** Embedding mode: env > memorix.yml > config.json > 'off' */
export function getEmbeddingMode(): 'off' | 'fastembed' | 'transformers' | 'api' | 'auto' {
  const env = process.env.MEMORIX_EMBEDDING?.toLowerCase()?.trim();
  if (env === 'fastembed' || env === 'transformers' || env === 'api' || env === 'auto') return env;
  const yml = loadYamlConfig();
  const ymlEmb = yml.embedding?.provider;
  if (ymlEmb === 'fastembed' || ymlEmb === 'transformers' || ymlEmb === 'api' || ymlEmb === 'auto') return ymlEmb;
  const cfg = loadFileConfig();
  if (cfg.embedding === 'fastembed' || cfg.embedding === 'transformers' || cfg.embedding === 'api' || cfg.embedding === 'auto') {
    return cfg.embedding;
  }
  return 'off';
}

/** Embedding API key: env > memorix.yml > config.json > LLM key fallback */
export function getEmbeddingApiKey(): string | undefined {
  return (
    process.env.MEMORIX_EMBEDDING_API_KEY ||  // Embedding-specific (优先级最高)
    process.env.MEMORIX_API_KEY ||  // Unified API key (fallback)
    process.env.MEMORIX_LLM_API_KEY ||
    loadYamlConfig().embedding?.apiKey ||
    loadFileConfig().embeddingApi?.apiKey ||
    loadYamlConfig().llm?.apiKey ||
    loadFileConfig().llm?.apiKey ||
    process.env.OPENAI_API_KEY ||
    undefined
  );
}

/** Embedding base URL: env > memorix.yml > config.json > LLM URL fallback */
export function getEmbeddingBaseUrl(): string {
  return (
    process.env.MEMORIX_EMBEDDING_BASE_URL ||
    loadYamlConfig().embedding?.baseUrl ||
    loadFileConfig().embeddingApi?.baseUrl ||
    process.env.MEMORIX_LLM_BASE_URL ||
    loadYamlConfig().llm?.baseUrl ||
    loadFileConfig().llm?.baseUrl ||
    'https://api.openai.com/v1'
  );
}

/** Embedding model: env > memorix.yml > config.json > default */
export function getEmbeddingModel(): string {
  return (
    process.env.MEMORIX_EMBEDDING_MODEL ||
    loadYamlConfig().embedding?.model ||
    loadFileConfig().embeddingApi?.model ||
    'text-embedding-3-small'
  );
}

/** Embedding dimensions override: env > memorix.yml > config.json > null (auto-detect) */
export function getEmbeddingDimensions(): number | null {
  const envDim = process.env.MEMORIX_EMBEDDING_DIMENSIONS;
  if (envDim) return parseInt(envDim, 10);
  const ymlDim = loadYamlConfig().embedding?.dimensions;
  if (ymlDim) return ymlDim;
  const cfgDim = loadFileConfig().embeddingApi?.dimensions;
  if (cfgDim) return cfgDim;
  return null;
}

// ─── YAML-specific getters (new config sections) ────────────────────

/** Git-Memory pipeline config */
export function getGitConfig(): NonNullable<MemorixYamlConfig['git']> {
  return loadYamlConfig().git ?? {};
}

/** Server config */
export function getServerConfig(): NonNullable<MemorixYamlConfig['server']> {
  return loadYamlConfig().server ?? {};
}

/** Team config */
export function getTeamConfig(): NonNullable<MemorixYamlConfig['team']> {
  return loadYamlConfig().team ?? {};
}

/** Get the full resolved YAML config (for status display) */
export { loadYamlConfig } from './config/yaml-loader.js';
