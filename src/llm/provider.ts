/**
 * LLM Provider
 *
 * Abstraction layer for LLM-enhanced memory management.
 * Supports OpenAI-compatible APIs (OpenAI, Anthropic via proxy, local models).
 *
 * This is the optional "premium" path — Memorix works without it,
 * but with an LLM configured, memory quality approaches Mem0/Cipher level.
 */

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'openrouter' | 'custom';
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

const LLM_TIMEOUT_DEFAULT_MS = 30_000;
const LLM_TIMEOUT_MIN_MS = 1_000;
const LLM_TIMEOUT_MAX_MS = 300_000;
const MAX_LLM_RESPONSE_BYTES = 2 * 1024 * 1024;

/**
 * Parse and validate MEMORIX_LLM_TIMEOUT_MS environment variable.
 * - Must be a valid integer in the range 1000–300000ms.
 * - Non-integer or out-of-range values log a warning and fall back to the default.
 * Default: 30000ms (30s) — allows for proxy routing and cold starts.
 */
export function parseLLMTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return LLM_TIMEOUT_DEFAULT_MS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || Number.isNaN(parsed)) {
    console.warn(
      `[memorix] MEMORIX_LLM_TIMEOUT_MS="${raw}" is invalid (must be a positive integer between ${LLM_TIMEOUT_MIN_MS}–${LLM_TIMEOUT_MAX_MS}ms). Using default ${LLM_TIMEOUT_DEFAULT_MS}ms.`,
    );
    return LLM_TIMEOUT_DEFAULT_MS;
  }
  if (parsed < LLM_TIMEOUT_MIN_MS) return LLM_TIMEOUT_MIN_MS;
  if (parsed > LLM_TIMEOUT_MAX_MS) return LLM_TIMEOUT_MAX_MS;
  return parsed;
}

const LLM_CALL_TIMEOUT_MS = parseLLMTimeoutMs(process.env.MEMORIX_LLM_TIMEOUT_MS);

export interface LLMResponse {
  content: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/** A single tool call requested by the LLM */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
}

/** Response from callLLMWithTools — may contain text, tool calls, or both */
export interface LLMToolResponse {
  content: string;
  toolCalls: ToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'stop' | 'unknown';
  usage?: { promptTokens: number; completionTokens: number };
}

/** Streaming event from callLLMWithToolsStream */
export type LLMStreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'done'; response: LLMToolResponse };

async function readResponseText(response: Response, signal?: AbortSignal, maxBytes = MAX_LLM_RESPONSE_BYTES): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error(`LLM response too large (${contentLength} bytes)`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    signal?.throwIfAborted();
    return response.text();
  }

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;
  const abortReader = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };

  signal?.addEventListener('abort', abortReader, { once: true });

  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      signal?.throwIfAborted();
      if (!value) continue;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel('response too large').catch(() => undefined);
        throw new Error(`LLM response exceeded ${maxBytes} bytes`);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }

    chunks.push(decoder.decode());
    signal?.throwIfAborted();
    return chunks.join('');
  } finally {
    signal?.removeEventListener('abort', abortReader);
    reader.releaseLock();
  }
}

async function readResponseJson<T>(response: Response, signal?: AbortSignal, maxBytes = MAX_LLM_RESPONSE_BYTES): Promise<T> {
  const text = await readResponseText(response, signal, maxBytes);
  return JSON.parse(text) as T;
}

/**
 * Call the LLM with tools in streaming mode.
 * Yields text chunks as they arrive, then a final 'done' event with the complete response.
 * Tool calls are accumulated and yielded at the end.
 */
export async function* callLLMWithToolsStream(
  messages: ChatMessage[],
  tools: ToolDefinition[],
): AsyncGenerator<LLMStreamEvent, void, undefined> {
  if (!currentConfig) {
    throw new Error('LLM not configured. Set MEMORIX_LLM_API_KEY or OPENAI_API_KEY.');
  }

  if (currentConfig.provider === 'anthropic') {
    yield* callAnthropicWithToolsStream(messages, tools);
    return;
  }

  yield* callOpenAIWithToolsStream(messages, tools);
}

/** Tool definition for LLM function calling */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
}

/** Chat message for multi-turn tool-use conversations */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;       // for role='tool': which call this result is for
  toolCalls?: ToolCall[];    // for role='assistant': tool calls made
  name?: string;             // for role='tool': function name
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
    const error = await readResponseText(response, undefined, 64 * 1024).catch(() => 'unknown error');
    throw new Error(`LLM API error (${response.status}): ${error}`);
  }

  const data = await readResponseJson<{
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  }>(response);

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
    const error = await readResponseText(response, undefined, 64 * 1024).catch(() => 'unknown error');
    throw new Error(`Anthropic API error (${response.status}): ${error}`);
  }

  const data = await readResponseJson<{
    content: Array<{ text: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  }>(response);

  return {
    content: data.content[0]?.text ?? '',
    usage: data.usage ? {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
    } : undefined,
  };
}

/**
 * Call the LLM with tool definitions (agentic harness pattern).
 *
 * The LLM can decide to call tools or respond directly.
 * Returns structured response with tool_calls for the agentic loop.
 */
export async function callLLMWithTools(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  signal?: AbortSignal,
): Promise<LLMToolResponse> {
  if (!currentConfig) {
    throw new Error('LLM not configured. Set MEMORIX_LLM_API_KEY or OPENAI_API_KEY.');
  }

  if (currentConfig.provider === 'anthropic') {
    return callAnthropicWithTools(messages, tools, signal);
  }

  return callOpenAIWithTools(messages, tools, signal);
}

/**
 * OpenAI-compatible tool calling (works with OpenAI, OpenRouter, Ollama, etc.)
 */
async function callOpenAIWithTools(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  signal?: AbortSignal,
): Promise<LLMToolResponse> {
  const config = currentConfig!;
  let base = config.baseUrl!.replace(/\/+$/, '');
  if (!base.endsWith('/v1')) base += '/v1';
  const url = `${base}/chat/completions`;

  // Convert ChatMessage[] to OpenAI format
  const openaiMessages: Array<Record<string, unknown>> = messages.map((msg) => {
    if (msg.role === 'tool') {
      return { role: 'tool', content: msg.content, tool_call_id: msg.toolCallId };
    }
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
    }
    return { role: msg.role, content: msg.content };
  });

  const openaiTools = tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  const fetchSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(LLM_CALL_TIMEOUT_MS)])
    : AbortSignal.timeout(LLM_CALL_TIMEOUT_MS);

  const response = await fetch(url, {
    signal: fetchSignal,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      temperature: 0.3,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const error = await readResponseText(response, signal, 64 * 1024).catch(() => 'unknown error');
    throw new Error(`LLM tool-call API error (${response.status}): ${error}`);
  }

  const data = await readResponseJson<{
    choices: Array<{
      message: {
        content: string | null;
        tool_calls?: Array<{
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }>;
      };
      finish_reason: string;
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  }>(response, signal);

  const choice = data.choices[0];
  const content = choice?.message?.content ?? '';
  const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map((tc: { id: string; function: { name: string; arguments: string } }) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: tc.function.arguments,
  }));

  const stopReason = choice?.finish_reason === 'tool_calls' ? 'tool_use'
    : choice?.finish_reason === 'stop' ? 'stop'
    : 'unknown';

  return {
    content,
    toolCalls,
    stopReason,
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
    } : undefined,
  };
}

/**
 * Anthropic tool calling (Messages API with tool_use).
 */
async function callAnthropicWithTools(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  signal?: AbortSignal,
): Promise<LLMToolResponse> {
  const config = currentConfig!;
  const url = `${config.baseUrl}/messages`;

  // Separate system message from the rest
  const systemContent = messages.find((m) => m.role === 'system')?.content ?? '';
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  // Convert to Anthropic message format
  const anthropicMessages: Array<Record<string, unknown>> = [];
  for (const msg of nonSystemMessages) {
    if (msg.role === 'user') {
      anthropicMessages.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      const contentBlocks: Array<Record<string, unknown>> = [];
      if (msg.content) contentBlocks.push({ type: 'text', text: msg.content });
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: JSON.parse(tc.arguments),
          });
        }
      }
      anthropicMessages.push({ role: 'assistant', content: contentBlocks });
    } else if (msg.role === 'tool') {
      anthropicMessages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.toolCallId,
          content: msg.content,
        }],
      });
    }
  }

  const anthropicTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  const fetchSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(LLM_CALL_TIMEOUT_MS)])
    : AbortSignal.timeout(LLM_CALL_TIMEOUT_MS);

  const response = await fetch(url, {
    signal: fetchSignal,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      system: systemContent,
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
      temperature: 0.3,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const error = await readResponseText(response, signal, 64 * 1024).catch(() => 'unknown error');
    throw new Error(`Anthropic tool-call API error (${response.status}): ${error}`);
  }

  const data = await readResponseJson<{
    content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
    stop_reason: string;
    usage?: { input_tokens: number; output_tokens: number };
  }>(response, signal);

  let content = '';
  const toolCalls: ToolCall[] = [];
  for (const block of data.content) {
    if (block.type === 'text' && block.text) {
      content += block.text;
    } else if (block.type === 'tool_use' && block.id && block.name) {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input ?? {}),
      });
    }
  }

  const stopReason = data.stop_reason === 'tool_use' ? 'tool_use'
    : data.stop_reason === 'end_turn' ? 'end_turn'
    : 'unknown';

  return {
    content,
    toolCalls,
    stopReason,
    usage: data.usage ? {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
    } : undefined,
  };
}

// ── Streaming implementations ────────────────────────────────────

/**
 * OpenAI-compatible streaming with tool support.
 * Parses SSE chunks, yields text deltas, accumulates tool calls.
 */
async function* callOpenAIWithToolsStream(
  messages: ChatMessage[],
  tools: ToolDefinition[],
): AsyncGenerator<LLMStreamEvent, void, undefined> {
  const config = currentConfig!;
  let base = config.baseUrl!.replace(/\/+$/, '');
  if (!base.endsWith('/v1')) base += '/v1';
  const url = `${base}/chat/completions`;

  const openaiMessages: Array<Record<string, unknown>> = messages.map((msg) => {
    if (msg.role === 'tool') {
      return { role: 'tool', content: msg.content, tool_call_id: msg.toolCallId };
    }
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
    }
    return { role: msg.role, content: msg.content };
  });

  const openaiTools = tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  const response = await fetch(url, {
    signal: AbortSignal.timeout(LLM_CALL_TIMEOUT_MS * 2), // longer timeout for streaming
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      temperature: 0.3,
      max_tokens: 2048,
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text().catch(() => 'unknown error');
    throw new Error(`LLM streaming API error (${response.status}): ${error}`);
  }

  // Parse SSE stream
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body for streaming');

  const decoder = new TextDecoder();
  let fullContent = '';
  const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();
  let finishReason = 'unknown';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const chunk = JSON.parse(trimmed.slice(6));
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            fullContent += delta.content;
            yield { type: 'text' as const, content: delta.content };
          }

          // Tool call deltas — accumulate
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallMap.has(idx)) {
                toolCallMap.set(idx, {
                  id: tc.id ?? '',
                  name: tc.function?.name ?? '',
                  arguments: tc.function?.arguments ?? '',
                });
              } else {
                const existing = toolCallMap.get(idx)!;
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) existing.arguments += tc.function.arguments;
              }
            }
          }

          // Finish reason
          if (chunk.choices?.[0]?.finish_reason) {
            finishReason = chunk.choices[0].finish_reason;
          }
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const toolCalls = [...toolCallMap.values()].map((tc) => ({
    id: tc.id,
    name: tc.name,
    arguments: tc.arguments,
  }));

  // Yield tool_call events
  for (const tc of toolCalls) {
    yield { type: 'tool_call' as const, toolCall: tc };
  }

  const stopReason = finishReason === 'tool_calls' ? 'tool_use'
    : finishReason === 'stop' ? 'stop'
    : 'unknown';

  yield {
    type: 'done' as const,
    response: {
      content: fullContent,
      toolCalls,
      stopReason,
    },
  };
}

/**
 * Anthropic streaming with tool support.
 * Parses SSE events, yields text deltas, accumulates tool_use blocks.
 */
async function* callAnthropicWithToolsStream(
  messages: ChatMessage[],
  tools: ToolDefinition[],
): AsyncGenerator<LLMStreamEvent, void, undefined> {
  const config = currentConfig!;
  const url = `${config.baseUrl}/messages`;

  const systemContent = messages.find((m) => m.role === 'system')?.content ?? '';
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  const anthropicMessages: Array<Record<string, unknown>> = [];
  for (const msg of nonSystemMessages) {
    if (msg.role === 'user') {
      anthropicMessages.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      const contentBlocks: Array<Record<string, unknown>> = [];
      if (msg.content) contentBlocks.push({ type: 'text', text: msg.content });
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: JSON.parse(tc.arguments),
          });
        }
      }
      anthropicMessages.push({ role: 'assistant', content: contentBlocks });
    } else if (msg.role === 'tool') {
      anthropicMessages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.toolCallId,
          content: msg.content,
        }],
      });
    }
  }

  const anthropicTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  const response = await fetch(url, {
    signal: AbortSignal.timeout(LLM_CALL_TIMEOUT_MS * 2),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      system: systemContent,
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
      temperature: 0.3,
      max_tokens: 2048,
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text().catch(() => 'unknown error');
    throw new Error(`Anthropic streaming API error (${response.status}): ${error}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body for streaming');

  const decoder = new TextDecoder();
  let fullContent = '';
  const toolCalls: ToolCall[] = [];
  let currentToolId = '';
  let currentToolName = '';
  let currentToolInput = '';
  let stopReason = 'unknown';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const event = JSON.parse(trimmed.slice(6));

          if (event.type === 'content_block_delta') {
            const delta = event.delta;
            if (delta?.type === 'text_delta' && delta.text) {
              fullContent += delta.text;
              yield { type: 'text' as const, content: delta.text };
            } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
              currentToolInput += delta.partial_json;
            }
          } else if (event.type === 'content_block_start') {
            const block = event.content_block;
            if (block?.type === 'tool_use') {
              currentToolId = block.id ?? '';
              currentToolName = block.name ?? '';
              currentToolInput = '';
            }
          } else if (event.type === 'content_block_stop') {
            // Finalize current tool call
            if (currentToolId && currentToolName) {
              const tc: ToolCall = {
                id: currentToolId,
                name: currentToolName,
                arguments: currentToolInput || '{}',
              };
              toolCalls.push(tc);
              yield { type: 'tool_call' as const, toolCall: tc };
              currentToolId = '';
              currentToolName = '';
              currentToolInput = '';
            }
          } else if (event.type === 'message_delta') {
            if (event.delta?.stop_reason) {
              stopReason = event.delta.stop_reason;
            }
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const mappedStopReason = stopReason === 'tool_use' ? 'tool_use'
    : stopReason === 'end_turn' ? 'end_turn'
    : 'unknown';

  yield {
    type: 'done' as const,
    response: {
      content: fullContent,
      toolCalls,
      stopReason: mappedStopReason,
    },
  };
}
