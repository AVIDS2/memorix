import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearOllamaOriginCache,
  mapOllamaEmbeddingResponse,
  routeOllamaEmbedding,
} from '../../src/embedding/ollama-embed.js';

afterEach(() => {
  clearOllamaOriginCache();
});

function versionFetch(payload: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(payload), { status })) as typeof fetch;
}

describe('ollama embedding keepalive', () => {
  it('rewrites any port once the origin identifies itself as Ollama', async () => {
    const fetchImpl = versionFetch({ version: '0.6.5' });
    const routed = await routeOllamaEmbedding(
      'http://ollama.internal:23456/v1/embeddings',
      { model: 'qwen3-embedding:4b', input: 'probe' },
      fetchImpl,
    );
    expect(routed.rewritten).toBe(true);
    expect(routed.url).toBe('http://ollama.internal:23456/api/embed');
    expect(routed.body.keep_alive).toBe('5m');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('does not treat port 11434 as Ollama when the version probe is absent', async () => {
    const body = { model: 'text-embedding-3-small', input: 'probe' };
    const fetchImpl = versionFetch({ error: 'not found' }, 404);
    const routed = await routeOllamaEmbedding('http://127.0.0.1:11434/v1/embeddings', body, fetchImpl);
    expect(routed.rewritten).toBe(false);
    expect(routed.url).toBe('http://127.0.0.1:11434/v1/embeddings');
    expect(routed.body).toEqual(body);
  });

  it('leaves OpenAI unchanged and remembers the negative probe', async () => {
    const fetchImpl = versionFetch({}, 404);
    const body = { model: 'text-embedding-3-small', input: 'probe' };
    const first = await routeOllamaEmbedding('https://api.openai.com/v1/embeddings', body, fetchImpl);
    const second = await routeOllamaEmbedding('https://api.openai.com/v1/embeddings', body, fetchImpl);
    expect(first.url).toBe('https://api.openai.com/v1/embeddings');
    expect(second.body).toEqual(body);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('keeps a caller-supplied keep_alive', async () => {
    const routed = await routeOllamaEmbedding(
      'http://10.0.0.8:18080/v1/embeddings',
      { model: 'nomic-embed-text', input: 'probe', keep_alive: '30s' },
      versionFetch({ version: '0.5.1' }),
    );
    expect(routed.url).toBe('http://10.0.0.8:18080/api/embed');
    expect(routed.body.keep_alive).toBe('30s');
  });

  it('maps a native embeddings array back to the OpenAI data shape', () => {
    const mapped = mapOllamaEmbeddingResponse({
      model: 'qwen3-embedding:4b',
      embeddings: [[0.1, 0.2]],
    });
    expect(mapped.data).toEqual([
      { object: 'embedding', index: 0, embedding: [0.1, 0.2] },
    ]);
  });
});
