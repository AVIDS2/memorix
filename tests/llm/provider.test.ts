import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callLLMWithTools, parseLLMTimeoutMs, setLLMConfig } from '../../src/llm/provider.js';

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
});
