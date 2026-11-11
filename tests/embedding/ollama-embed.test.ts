import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearOllamaOriginCache,
  mapOllamaEmbeddingResponse,
  routeOllamaEmbedding,
} from '../../src/embedding/ollama-embed.js';

afterEach(() => {
  clearOllamaOriginCache();
  vi.restoreAllMocks();
});

function versionFetch(payload: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
}

describe('ollama embedding keepalive', () => {
  it('rewrites an Ollama origin without contacting that host', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch');
    const fetchImpl = versionFetch({ version: '0.6.5' });
    const routed = await routeOllamaEmbedding(
      'https://embeddings.invalid:23456/v1/embeddings',
      { model: 'example-embed', input: 'probe' },
      fetchImpl,
    );

    expect(routed.rewritten).toBe(true);
    expect(routed.url).toBe('https://embeddings.invalid:23456/api/embed');
    expect(routed.body.keep_alive).toBe('5m');
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
      'https://embeddings.invalid:23456/api/version',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('does not treat a port number as Ollama when the injected probe is not Ollama', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch');
    const body = { model: 'example-embed', input: 'probe' };
    const fetchImpl = versionFetch({ error: 'not found' }, 404);
    const routed = await routeOllamaEmbedding(
      'http://not-ollama.invalid:11434/v1/embeddings',
      body,
      fetchImpl,
    );

    expect(routed.rewritten).toBe(false);
    expect(routed.url).toBe('http://not-ollama.invalid:11434/v1/embeddings');
    expect(routed.body).toEqual(body);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('remembers a negative probe and never falls through to the runtime fetch', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch');
    const fetchImpl = versionFetch({}, 404);
    const body = { model: 'example-embed', input: 'probe' };
    const url = 'https://vendor.invalid/v1/embeddings';

    const first = await routeOllamaEmbedding(url, body, fetchImpl);
    const second = await routeOllamaEmbedding(url, body, fetchImpl);

    expect(first.url).toBe(url);
    expect(second.body).toEqual(body);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('keeps a caller-supplied keep_alive', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch');
    const routed = await routeOllamaEmbedding(
      'https://embeddings.invalid/v1/embeddings',
      { model: 'example-embed', input: 'probe', keep_alive: '30s' },
      versionFetch({ version: '0.5.1' }),
    );

    expect(routed.url).toBe('https://embeddings.invalid/api/embed');
    expect(routed.body.keep_alive).toBe('30s');
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('maps a native embeddings array back to the OpenAI data shape', () => {
    const mapped = mapOllamaEmbeddingResponse({
      model: 'example-embed',
      embeddings: [[0.1, 0.2]],
    });
    expect(mapped.data).toEqual([
      { object: 'embedding', index: 0, embedding: [0.1, 0.2] },
    ]);
  });
});
