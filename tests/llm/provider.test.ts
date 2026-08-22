import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callLLM,
  callLLMWithTools,
  callLLMWithToolsStream,
  initLLM,
  normalizeOpenAICompatibleBaseUrl,
  parseLLMTimeoutMs,
  setLLMConfig,
} from '../../src/llm/provider.ts';

const LLM_ENV_KEYS = [
  'MEMORIX_AGENT_API_KEY',
  'MEMORIX_AGENT_PROVIDER',
  'MEMORIX_AGENT_MODEL',
  'MEMORIX_AGENT_BASE_URL',
  'MEMORIX_AGENT_LLM_API_KEY',
  'MEMORIX_AGENT_LLM_PROVIDER',
  'MEMORIX_AGENT_LLM_MODEL',
  'MEMORIX_AGENT_LLM_BASE_URL',
  'MEMORIX_LLM_API_KEY',
  'MEMORIX_LLM_PROVIDER',
  'MEMORIX_LLM_MODEL',
  'MEMORIX_LLM_BASE_URL',
  'MEMORIX_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
];

function clearLLMEnv() {
  for (const key of LLM_ENV_KEYS) delete process.env[key];
}

describe('initLLM config scopes', () => {
  beforeEach(() => {
    clearLLMEnv();
    setLLMConfig(null);
  });

  afterEach(() => {
    clearLLMEnv();
    setLLMConfig(null);
  });

  it('uses agent-specific LLM env vars for TUI agent scope', () => {
    process.env.MEMORIX_LLM_API_KEY = 'sk-memory';
    process.env.MEMORIX_LLM_MODEL = 'memory-model';
    process.env.MEMORIX_AGENT_LLM_API_KEY = 'sk-agent';
    process.env.MEMORIX_AGENT_LLM_PROVIDER = 'openrouter';
    process.env.MEMORIX_AGENT_LLM_MODEL = 'agent-model';
    process.env.MEMORIX_AGENT_LLM_BASE_URL = 'https://agent.example.com/v1';

    const config = initLLM({ scope: 'agent' });

    expect(config).toEqual({
      provider: 'openrouter',
      apiKey: 'sk-agent',
      model: 'agent-model',
      baseUrl: 'https://agent.example.com/v1',
    });
  });

  it('uses short MEMORIX_AGENT_* env aliases for TUI agent scope', () => {
    process.env.MEMORIX_LLM_API_KEY = 'sk-memory';
    process.env.MEMORIX_LLM_MODEL = 'memory-model';
    process.env.MEMORIX_AGENT_API_KEY = 'sk-agent-short';
    process.env.MEMORIX_AGENT_PROVIDER = 'openrouter';
    process.env.MEMORIX_AGENT_MODEL = 'agent-short-model';
    process.env.MEMORIX_AGENT_BASE_URL = 'https://agent-short.example.com/v1';

    const config = initLLM({ scope: 'agent' });

    expect(config).toEqual({
      provider: 'openrouter',
      apiKey: 'sk-agent-short',
      model: 'agent-short-model',
      baseUrl: 'https://agent-short.example.com/v1',
    });
  });

  it('prefers short MEMORIX_AGENT_* aliases over legacy MEMORIX_AGENT_LLM_* aliases', () => {
    process.env.MEMORIX_AGENT_API_KEY = 'sk-agent-short';
    process.env.MEMORIX_AGENT_LLM_API_KEY = 'sk-agent-legacy';
    process.env.MEMORIX_AGENT_PROVIDER = 'openrouter';
    process.env.MEMORIX_AGENT_LLM_PROVIDER = 'openai';
    process.env.MEMORIX_AGENT_MODEL = 'agent-short-model';
    process.env.MEMORIX_AGENT_LLM_MODEL = 'agent-legacy-model';
    process.env.MEMORIX_AGENT_BASE_URL = 'https://agent-short.example.com/v1';
    process.env.MEMORIX_AGENT_LLM_BASE_URL = 'https://agent-legacy.example.com/v1';

    const config = initLLM({ scope: 'agent' });

    expect(config).toEqual({
      provider: 'openrouter',
      apiKey: 'sk-agent-short',
      model: 'agent-short-model',
      baseUrl: 'https://agent-short.example.com/v1',
    });
  });

  it('keeps memory LLM scope on existing MEMORIX_LLM_* config', () => {
    process.env.MEMORIX_LLM_API_KEY = 'sk-memory';
    process.env.MEMORIX_LLM_PROVIDER = 'openai';
    process.env.MEMORIX_LLM_MODEL = 'memory-model';

    const config = initLLM({ scope: 'memory' });

    expect(config?.apiKey).toBe('sk-memory');
    expect(config?.model).toBe('memory-model');
  });

  it('falls back to memory LLM config for agent scope when no agent config exists', () => {
    process.env.MEMORIX_LLM_API_KEY = 'sk-memory';
    process.env.MEMORIX_LLM_MODEL = 'memory-model';

    const config = initLLM({ scope: 'agent' });

    expect(config?.apiKey).toBe('sk-memory');
    expect(config?.model).toBe('memory-model');
  });
});

describe('parseLLMTimeoutMs', () => {
  it('returns default when env var is undefined', () => {
    expect(parseLLMTimeoutMs(undefined)).toBe(30_000);
  });

  it('returns default when env var is empty string', () => {
    expect(parseLLMTimeoutMs('')).toBe(30_000);
  });

  it('returns default for non-numeric string', () => {
    expect(parseLLMTimeoutMs('abc')).toBe(30_000);
  });

  it('returns default for float string', () => {
    expect(parseLLMTimeoutMs('1500.5')).toBe(30_000);
  });

  it('returns default for NaN-producing input', () => {
    expect(parseLLMTimeoutMs('NaN')).toBe(30_000);
  });

  it('parses valid integer correctly', () => {
    expect(parseLLMTimeoutMs('60000')).toBe(60_000);
  });

  it('clamps to minimum (1000ms) when value is too small', () => {
    expect(parseLLMTimeoutMs('0')).toBe(1_000);
    expect(parseLLMTimeoutMs('500')).toBe(1_000);
    expect(parseLLMTimeoutMs('-5000')).toBe(1_000);
  });

  it('clamps to maximum (300000ms) when value is too large', () => {
    expect(parseLLMTimeoutMs('999999')).toBe(300_000);
    expect(parseLLMTimeoutMs('300001')).toBe(300_000);
  });

  it('accepts boundary values exactly', () => {
    expect(parseLLMTimeoutMs('1000')).toBe(1_000);
    expect(parseLLMTimeoutMs('300000')).toBe(300_000);
  });
});

describe('normalizeOpenAICompatibleBaseUrl', () => {
  it('adds /v1 only to a bare API host', () => {
    expect(normalizeOpenAICompatibleBaseUrl('http://localhost:11434')).toBe('http://localhost:11434/v1');
  });

  it('preserves explicit v1 through v4 API paths', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://api.example.com/v1')).toBe('https://api.example.com/v1');
    expect(normalizeOpenAICompatibleBaseUrl('https://api.example.com/v2/')).toBe('https://api.example.com/v2');
    expect(normalizeOpenAICompatibleBaseUrl('https://ark.cn-beijing.volces.com/api/v3')).toBe('https://ark.cn-beijing.volces.com/api/v3');
    expect(normalizeOpenAICompatibleBaseUrl('https://api.example.com/v4')).toBe('https://api.example.com/v4');
  });

  it('preserves provider version variants such as v1beta', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://generativelanguage.googleapis.com/v1beta')).toBe('https://generativelanguage.googleapis.com/v1beta');
  });
});

describe('callLLMWithTools', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setLLMConfig({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4.1-nano',
      baseUrl: 'https://api.openai.com/v1',
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setLLMConfig(null);
    vi.restoreAllMocks();
  });

  it('aborts while reading a non-streaming response body', async () => {
    const ac = new AbortController();
    const encoder = new TextEncoder();
    const cancel = vi.fn(async () => undefined);
    const releaseLock = vi.fn();
    let readCount = 0;
    const reader: Pick<ReadableStreamDefaultReader<Uint8Array>, 'read' | 'cancel' | 'releaseLock'> = {
      read: vi.fn(async () => {
        if (readCount++ === 0) {
          return {
            value: encoder.encode('{"choices":[{"message":{"content":"partial'),
            done: false,
          };
        }

        return await new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
          setTimeout(() => {
            ac.abort(new DOMException('User cancelled', 'AbortError'));
          }, 0);
          ac.signal.addEventListener('abort', () => reject(ac.signal.reason), { once: true });
        });
      }),
      cancel,
      releaseLock,
    };

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body: {
        getReader: () => reader as ReadableStreamDefaultReader<Uint8Array>,
      },
    } as unknown as Response)) as typeof fetch;

    await expect(callLLMWithTools([
      { role: 'user', content: 'Hello?' },
    ], [], ac.signal)).rejects.toThrow(/abort|cancel/i);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized non-streaming responses before parsing the full body', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({
        'Content-Type': 'application/json',
        'content-length': String(3 * 1024 * 1024),
      }),
      body: null,
    } as unknown as Response)) as typeof fetch;

    await expect(callLLMWithTools([
      { role: 'user', content: 'Hello?' },
    ], [])).rejects.toThrow(/too large/i);
  });

  it('uses a provider-supplied /api/v3 root without appending /v1', async () => {
    setLLMConfig({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'deepseek-v4-flash-ga-260731',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    });
    let requestedUrl = '';
    globalThis.fetch = vi.fn(async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    await callLLMWithTools([{ role: 'user', content: 'Hello?' }], []);

    expect(requestedUrl).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions');
  });
});

describe('OpenAI-compatible ordinary and streaming calls', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setLLMConfig(null);
    vi.restoreAllMocks();
  });

  it('uses a provider-supplied /api/v3 root for ordinary chat calls', async () => {
    setLLMConfig({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'deepseek-v4-flash-ga-260731',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    });
    let requestedUrl = '';
    globalThis.fetch = vi.fn(async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    await callLLM('system', 'user');

    expect(requestedUrl).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions');
  });

  it('uses a provider-supplied /api/v3 root for streaming tool calls', async () => {
    setLLMConfig({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'deepseek-v4-flash-ga-260731',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    });
    let requestedUrl = '';
    globalThis.fetch = vi.fn(async (input) => {
      requestedUrl = String(input);
      return new Response(
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n' +
        'data: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }) as typeof fetch;

    const events = [];
    for await (const event of callLLMWithToolsStream([{ role: 'user', content: 'Hello?' }], [])) {
      events.push(event);
    }

    expect(requestedUrl).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions');
    expect(events.some((event) => event.type === 'text' && event.content === 'ok')).toBe(true);
  });
});
