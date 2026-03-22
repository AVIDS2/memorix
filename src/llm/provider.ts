/**
 * LLM Provider
 *
 * Abstraction layer for LLM-enhanced memory management.
 * Supports OpenAI-compatible APIs (OpenAI, Anthropic via proxy, local models).
 *
 * This is the optional "premium" path — Memorix works without it,
 * but with an LLM configured, memory quality approaches Mem0/Cipher level.
 */

/** Per-call timeout for LLM API requests (ms). Prevents a single slow call from blocking the store path. */
const LLM_CALL_TIMEOUT_MS = 12_000;

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'openrouter' | 'custom';
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export interface LLMResponse {
  content: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/** Provider defaults per provider type */
const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-nano' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-latest' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-nano' },
  custom: { baseUrl: 'http://localhost:11434/v1', model: 'llama3' },
};

let currentConfig: LLMConfig | null = null;

/**
 * Initialize the LLM provider from environment variables.
 * Returns null if no API key is configured — Memorix gracefully degrades.
 */
export function initLLM(): LLMConfig | null {
  // Unified config: env vars > config.json > defaults
  const { getLLMApiKey, getLLMProvider, getLLMModel, getLLMBaseUrl } = require('../config.js');

  const apiKey = getLLMApiKey();
  if (!apiKey) {
    currentConfig = null;
    return null;
  }

  const provider = getLLMProvider() as LLMConfig['provider'];
  const defaults = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.openai;

  currentConfig = {
    provider,
    apiKey,
    model: getLLMModel(defaults.model),
    baseUrl: getLLMBaseUrl(defaults.baseUrl),
  };

  return currentConfig;
}

/**
 * Check if LLM is available.
 */
export function isLLMEnabled(): boolean {
  return currentConfig !== null;
}

/**
 * Get current LLM config (for display/debug).
 */
export function getLLMConfig(): LLMConfig | null {
  return currentConfig;
}

/**
 * Set LLM config directly (for testing or programmatic use).
 */
export function setLLMConfig(config: LLMConfig | null): void {
  currentConfig = config;
}

/**
 * Call the LLM with a prompt.
 * Uses OpenAI-compatible chat completions API (works with OpenRouter, Ollama, etc.)
 *
 * For Anthropic, we use their Messages API directly.
 */
export async function callLLM(
  systemPrompt: string,
  userMessage: string,
): Promise<LLMResponse> {
  if (!currentConfig) {
    throw new Error('LLM not configured. Set MEMORIX_LLM_API_KEY or OPENAI_API_KEY.');
  }

  if (currentConfig.provider === 'anthropic') {
    return callAnthropic(systemPrompt, userMessage);
  }

  return callOpenAICompatible(systemPrompt, userMessage);
}

/**
 * OpenAI-compatible API call (works with OpenAI, OpenRouter, Ollama, etc.)
 */
async function callOpenAICompatible(
  systemPrompt: string,
  userMessage: string,
): Promise<LLMResponse> {
  const config = currentConfig!;
  // Auto-fix: append /v1 if baseUrl doesn't end with it (common user mistake)
  let base = config.baseUrl!.replace(/\/+$/, '');
  if (!base.endsWith('/v1')) base += '/v1';
  const url = `${base}/chat/completions`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(LLM_CALL_TIMEOUT_MS),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const error = await response.text().catch(() => 'unknown error');
    throw new Error(`LLM API error (${response.status}): ${error}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content: data.choices[0]?.message?.content ?? '',
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
    } : undefined,
  };
}

/**
 * Anthropic Messages API call.
 */
async function callAnthropic(
  systemPrompt: string,
  userMessage: string,
): Promise<LLMResponse> {
  const config = currentConfig!;
  const url = `${config.baseUrl}/messages`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(LLM_CALL_TIMEOUT_MS),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const error = await response.text().catch(() => 'unknown error');
    throw new Error(`Anthropic API error (${response.status}): ${error}`);
  }

  const data = await response.json() as {
    content: Array<{ text: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };

  return {
    content: data.content[0]?.text ?? '',
    usage: data.usage ? {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
    } : undefined,
  };
}
