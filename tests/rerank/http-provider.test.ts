/**
 * HTTP rerank provider tests.
 *
 * Cohere-compatible POST {base_url}/rerank. Model id is sent as configured.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRerankUrl,
  parseRerankResponse,
  rerankViaHttp,
} from '../../src/rerank/http-provider.js';

const EXAMPLE_BASE = 'https://api.example.com/v1';
const EXAMPLE_MODEL = 'rerank-model';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('buildRerankUrl', () => {
  it('appends /rerank to a v1 base URL', () => {
    expect(buildRerankUrl(EXAMPLE_BASE)).toBe(`${EXAMPLE_BASE}/rerank`);
    expect(buildRerankUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1/rerank');
  });

  it('keeps an explicit /rerank path', () => {
    expect(buildRerankUrl('http://127.0.0.1:8080/rerank')).toBe('http://127.0.0.1:8080/rerank');
  });
});

describe('parseRerankResponse', () => {
  it('reads Cohere results[].relevance_score', () => {
    const ranked = parseRerankResponse({
      results: [
        { index: 2, relevance_score: 0.91 },
        { index: 0, relevance_score: 0.4 },
      ],
    });
    expect(ranked).toEqual([
      { index: 2, score: 0.91 },
      { index: 0, score: 0.4 },
    ]);
  });

  it('reads TEI [{index, score}] arrays', () => {
    const ranked = parseRerankResponse([
      { index: 1, score: 0.8 },
      { index: 0, score: 0.2 },
    ]);
    expect(ranked).toEqual([
      { index: 1, score: 0.8 },
      { index: 0, score: 0.2 },
    ]);
  });

  it('rejects empty or malformed payloads', () => {
    expect(() => parseRerankResponse({})).toThrow(/rerank/i);
    expect(() => parseRerankResponse({ results: [] })).toThrow(/rerank/i);
  });
});

describe('rerankViaHttp', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the Cohere wire format to {base_url}/rerank', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`${EXAMPLE_BASE}/rerank`);
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer rerank-key');
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        model: EXAMPLE_MODEL,
        query: 'JWT expiry',
        documents: ['gotcha about tokens', 'unrelated database note'],
        top_n: 2,
        return_documents: false,
      });
      return jsonResponse({
        model: EXAMPLE_MODEL,
        results: [
          { index: 0, relevance_score: 0.88 },
          { index: 1, relevance_score: 0.11 },
        ],
      });
    });

    const ranked = await rerankViaHttp(
      'JWT expiry',
      ['gotcha about tokens', 'unrelated database note'],
      {
        provider: 'http',
        model: EXAMPLE_MODEL,
        baseUrl: EXAMPLE_BASE,
        apiKey: 'rerank-key',
        fetchImpl,
      },
    );

    expect(ranked.map((row) => row.index)).toEqual([0, 1]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends the configured model string unchanged', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('vendor/rerank-large');
      return jsonResponse({ results: [{ index: 0, relevance_score: 1 }] });
    });

    await rerankViaHttp('q', ['a'], {
      provider: 'http',
      model: 'vendor/rerank-large',
      baseUrl: EXAMPLE_BASE,
      fetchImpl,
    });
  });

  it('omits model when none is configured', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBeUndefined();
      return jsonResponse({ results: [{ index: 0, relevance_score: 1 }] });
    });

    await rerankViaHttp('q', ['a'], {
      provider: 'http',
      baseUrl: EXAMPLE_BASE,
      fetchImpl,
    });
  });

  it('omits Authorization when no API key is configured', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBeNull();
      return jsonResponse({ results: [{ index: 0, relevance_score: 1 }] });
    });

    await rerankViaHttp('q', ['only'], {
      provider: 'http',
      baseUrl: 'http://127.0.0.1:8080',
      fetchImpl,
    });
  });

  it('throws on HTTP errors so the caller can fall back to LLM rerank', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'nope' }, 502));

    await expect(rerankViaHttp('q', ['a', 'b'], {
      provider: 'http',
      baseUrl: EXAMPLE_BASE,
      apiKey: 'k',
      fetchImpl,
    })).rejects.toThrow(/502/);
  });
});
