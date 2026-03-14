/**
 * API Embedding Provider Tests
 *
 * Tests the remote API embedding provider with mocked fetch calls.
 * Covers: initialization, single embed, batch embed, caching, retry, errors.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock Headers for consistent behavior
function mockHeaders(entries: [string, string][] = []): { get: (key: string) => string | null } {
  const map = new Map(entries);
  return { get: (key: string) => map.get(key) ?? null };
}

// Mock fs for disk cache
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('no cache')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

import { APIEmbeddingProvider } from '../../src/embedding/api-provider.js';

// Helper: create a mock embedding response
function mockEmbeddingResponse(embeddings: number[][], model = 'text-embedding-3-small') {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      object: 'list',
      data: embeddings.map((embedding, index) => ({
        object: 'embedding',
        index,
        embedding,
      })),
      model,
      usage: {
        prompt_tokens: 10 * embeddings.length,
        total_tokens: 10 * embeddings.length,
      },
    }),
    headers: mockHeaders(),
  };
}

// Helper: create a fixed-size embedding vector
function makeVector(dims: number, seed = 0.1): number[] {
  return Array.from({ length: dims }, (_, i) => Math.sin(seed * (i + 1)));
}

describe('API Embedding Provider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    process.env = {
      ...originalEnv,
      MEMORIX_EMBEDDING: 'api',
      MEMORIX_EMBEDDING_API_KEY: 'test-key-123',
      MEMORIX_EMBEDDING_BASE_URL: 'https://api.test.com/v1',
      MEMORIX_EMBEDDING_MODEL: 'text-embedding-3-small',
    };
    // Remove dimension override and unified key by default
    delete process.env.MEMORIX_EMBEDDING_DIMENSIONS;
    delete process.env.MEMORIX_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('initialization', () => {
    it('should probe API and detect dimensions', async () => {
      const vec1536 = makeVector(1536);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([vec1536]));

      const provider = await APIEmbeddingProvider.create();

      expect(provider.dimensions).toBe(1536);
      expect(provider.name).toBe('api-text-embedding-3-small');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify probe request
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.test.com/v1/embeddings');
      const body = JSON.parse(options.body);
      expect(body.model).toBe('text-embedding-3-small');
      expect(body.input).toBe('dimension probe');
    });

    it('should support custom dimensions (shortening)', async () => {
      process.env.MEMORIX_EMBEDDING_DIMENSIONS = '512';
      const vec512 = makeVector(512);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([vec512]));

      const provider = await APIEmbeddingProvider.create();

      expect(provider.dimensions).toBe(512);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.dimensions).toBe(512);
    });

    it('should fall back to LLM API key if embedding key not set', async () => {
      delete process.env.MEMORIX_EMBEDDING_API_KEY;
      process.env.MEMORIX_LLM_API_KEY = 'llm-key-456';

      const vec384 = makeVector(384);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([vec384]));

      const provider = await APIEmbeddingProvider.create();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBe('Bearer llm-key-456');
    });

    it('should fall back to OPENAI_API_KEY', async () => {
      delete process.env.MEMORIX_EMBEDDING_API_KEY;
      delete process.env.MEMORIX_LLM_API_KEY;
      process.env.OPENAI_API_KEY = 'openai-key-789';

      const vec1536 = makeVector(1536);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([vec1536]));

      const provider = await APIEmbeddingProvider.create();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBe('Bearer openai-key-789');
    });

    it('should throw if no API key available', async () => {
      delete process.env.MEMORIX_EMBEDDING_API_KEY;
      delete process.env.MEMORIX_LLM_API_KEY;
      delete process.env.OPENAI_API_KEY;

      await expect(APIEmbeddingProvider.create()).rejects.toThrow('No API key');
    });

    it('should throw if probe returns empty data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
        headers: mockHeaders(),
      });

      await expect(APIEmbeddingProvider.create()).rejects.toThrow('probe returned no embeddings');
    });
  });

  describe('single embed', () => {
    it('should embed a single text', async () => {
      const vec = makeVector(1536);
      // Probe call
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([vec]));

      const provider = await APIEmbeddingProvider.create();

      // Embed call
      const embedVec = makeVector(1536, 0.5);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([embedVec]));

      const result = await provider.embed('hello world');

      expect(result).toEqual(embedVec);
      expect(result.length).toBe(1536);
    });

    it('should return cached result on second call', async () => {
      const vec = makeVector(1536);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([vec]));
      const provider = await APIEmbeddingProvider.create();

      const embedVec = makeVector(1536, 0.5);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([embedVec]));

      const result1 = await provider.embed('cache-single-test');
      const result2 = await provider.embed('cache-single-test');

      // Second call should not trigger a new fetch
      expect(mockFetch).toHaveBeenCalledTimes(2); // probe + 1 embed only
      expect(result1).toEqual(result2);
    });
  });

  describe('batch embed', () => {
    it('should batch embed multiple texts', async () => {
      const probeVec = makeVector(1536);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([probeVec]));
      const provider = await APIEmbeddingProvider.create();

      const vecs = [makeVector(1536, 0.1), makeVector(1536, 0.2), makeVector(1536, 0.3)];
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse(vecs));

      const results = await provider.embedBatch(['text1', 'text2', 'text3']);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual(vecs[0]);
      expect(results[1]).toEqual(vecs[1]);
      expect(results[2]).toEqual(vecs[2]);
    });

    it('should skip cached texts in batch', async () => {
      const probeVec = makeVector(1536);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([probeVec]));
      const provider = await APIEmbeddingProvider.create();

      // First: embed one text
      const vec1 = makeVector(1536, 0.1);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([vec1]));
      await provider.embed('batch-cached-text-unique');

      // Batch with one cached and one new
      const vec2 = makeVector(1536, 0.2);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([vec2]));
      const results = await provider.embedBatch(['batch-cached-text-unique', 'batch-new-text-unique']);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(vec1); // from cache
      // The API call should only contain 1 text (the new one)
      const lastBody = JSON.parse(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body);
      expect(lastBody.input).toEqual(['batch-new-text-unique']);
    });

    it('should return all from cache if nothing to embed', async () => {
      const probeVec = makeVector(1536);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([probeVec]));
      const provider = await APIEmbeddingProvider.create();

      // Embed two texts
      const vec1 = makeVector(1536, 0.1);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([vec1]));
      await provider.embed('allcache-text-a');

      const vec2 = makeVector(1536, 0.2);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([vec2]));
      await provider.embed('allcache-text-b');

      const callCount = mockFetch.mock.calls.length;
      const results = await provider.embedBatch(['allcache-text-a', 'allcache-text-b']);

      expect(results).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(callCount); // No new calls
    });
  });

  describe('error handling & retry', () => {
    it('should retry on 429 rate limit', async () => {
      const probeVec = makeVector(1536);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([probeVec]));
      const provider = await APIEmbeddingProvider.create();

      const embedVec = makeVector(1536, 0.5);
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: mockHeaders([['retry-after', '0']]),
          text: () => Promise.resolve('rate limited'),
        })
        .mockResolvedValueOnce(mockEmbeddingResponse([embedVec]));

      const result = await provider.embed('retry test');
      expect(result).toEqual(embedVec);
      // probe + 429 + retry success = 3
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should retry on 500 server error', async () => {
      const probeVec = makeVector(1536);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([probeVec]));
      const provider = await APIEmbeddingProvider.create();

      const embedVec = makeVector(1536, 0.5);
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          headers: mockHeaders(),
          text: () => Promise.resolve('server error'),
        })
        .mockResolvedValueOnce(mockEmbeddingResponse([embedVec]));

      const result = await provider.embed('server error test');
      expect(result).toEqual(embedVec);
    });

    it('should throw on 401 unauthorized (no retry)', async () => {
      const probeVec = makeVector(1536);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([probeVec]));
      const provider = await APIEmbeddingProvider.create();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: mockHeaders(),
        text: () => Promise.resolve('unauthorized'),
      });

      await expect(provider.embed('auth fail')).rejects.toThrow('401');
    });

    it('should detect dimension mismatch', async () => {
      const probeVec = makeVector(1536);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([probeVec]));
      const provider = await APIEmbeddingProvider.create();

      // Return wrong dimensions
      const wrongVec = makeVector(768);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([wrongVec]));

      await expect(provider.embed('dim mismatch')).rejects.toThrow('dimension mismatch');
    });
  });

  describe('usage tracking', () => {
    it('should track API call stats', async () => {
      const probeVec = makeVector(1536);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([probeVec]));
      const provider = await APIEmbeddingProvider.create();

      const embedVec = makeVector(1536, 0.5);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([embedVec]));
      await provider.embed('stats test');

      const stats = provider.getStats();
      expect(stats.totalApiCalls).toBe(1);
      expect(stats.totalTokens).toBe(10);
      expect(stats.cacheSize).toBeGreaterThan(0);
    });
  });

  describe('Qwen model compatibility', () => {
    it('should work with Qwen text-embedding-v3 (1024d)', async () => {
      process.env.MEMORIX_EMBEDDING_MODEL = 'text-embedding-v3';
      process.env.MEMORIX_EMBEDDING_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

      const vec1024 = makeVector(1024);
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([vec1024], 'text-embedding-v3'));

      const provider = await APIEmbeddingProvider.create();

      expect(provider.dimensions).toBe(1024);
      expect(provider.name).toBe('api-text-embedding-v3');
    });
  });
});
