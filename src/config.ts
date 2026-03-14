/**
 * Unified Configuration Reader
 *
 * Priority chain (highest wins):
 *   1. Environment variables (from MCP JSON `env` field or system env)
 *   2. ~/.memorix/config.json (written by `memorix configure` TUI)
 *   3. Hardcoded defaults
 *
 * This ensures `memorix configure` actually takes effect at runtime,
 * while env vars can still override for advanced users.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

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

/** LLM API key: MEMORIX_API_KEY (unified) > MEMORIX-specific env > config.json > generic env fallbacks */
export function getLLMApiKey(): string | undefined {
  return (
    process.env.MEMORIX_API_KEY ||  // Unified API key (方案1)
    process.env.MEMORIX_LLM_API_KEY ||
    loadFileConfig().llm?.apiKey ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    undefined
  );
}

/** LLM provider: env > config.json > auto-detect */
export function getLLMProvider(): string {
  if (process.env.MEMORIX_LLM_PROVIDER) return process.env.MEMORIX_LLM_PROVIDER;
  const cfg = loadFileConfig();
  if (cfg.llm?.provider) return cfg.llm.provider;
  // Auto-detect from env var names
  if (process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) return 'anthropic';
  if (process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY) return 'openrouter';
  return 'openai';
}

/** LLM model: env > config.json > provider default */
export function getLLMModel(providerDefault: string): string {
  return process.env.MEMORIX_LLM_MODEL || loadFileConfig().llm?.model || providerDefault;
}

/** LLM base URL: env > config.json > provider default */
export function getLLMBaseUrl(providerDefault: string): string {
  return process.env.MEMORIX_LLM_BASE_URL || loadFileConfig().llm?.baseUrl || providerDefault;
}

/** Embedding mode: env > config.json > 'off' */
export function getEmbeddingMode(): 'off' | 'fastembed' | 'transformers' | 'api' | 'auto' {
  const env = process.env.MEMORIX_EMBEDDING?.toLowerCase()?.trim();
  if (env === 'fastembed' || env === 'transformers' || env === 'api' || env === 'auto') return env;
  const cfg = loadFileConfig();
  if (cfg.embedding === 'fastembed' || cfg.embedding === 'transformers' || cfg.embedding === 'api' || cfg.embedding === 'auto') {
    return cfg.embedding;
  }
  return 'off';
}

/** Embedding API key: MEMORIX_API_KEY (unified) > MEMORIX-specific env > config.json > LLM key fallback */
export function getEmbeddingApiKey(): string | undefined {
  return (
    process.env.MEMORIX_API_KEY ||  // Unified API key (方案1)
    process.env.MEMORIX_EMBEDDING_API_KEY ||
    loadFileConfig().embeddingApi?.apiKey ||
    process.env.MEMORIX_LLM_API_KEY ||
    loadFileConfig().llm?.apiKey ||
    process.env.OPENAI_API_KEY ||
    undefined
  );
}

/** Embedding base URL: env > config.json > LLM URL fallback */
export function getEmbeddingBaseUrl(): string {
  return (
    process.env.MEMORIX_EMBEDDING_BASE_URL ||
    loadFileConfig().embeddingApi?.baseUrl ||
    process.env.MEMORIX_LLM_BASE_URL ||
    loadFileConfig().llm?.baseUrl ||
    'https://api.openai.com/v1'
  );
}

/** Embedding model: env > config.json > default */
export function getEmbeddingModel(): string {
  return (
    process.env.MEMORIX_EMBEDDING_MODEL ||
    loadFileConfig().embeddingApi?.model ||
    'text-embedding-3-small'
  );
}

/** Embedding dimensions override: env > config.json > null (auto-detect) */
export function getEmbeddingDimensions(): number | null {
  const envDim = process.env.MEMORIX_EMBEDDING_DIMENSIONS;
  if (envDim) return parseInt(envDim, 10);
  const cfgDim = loadFileConfig().embeddingApi?.dimensions;
  if (cfgDim) return cfgDim;
  return null;
}
