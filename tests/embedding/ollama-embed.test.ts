import { describe, expect, it } from 'vitest';
import {
  adaptOllamaEmbeddingRequest,
  mapOllamaEmbeddingResponse,
  shouldMapOllamaEmbeddingResponse,
} from '../../src/embedding/ollama-embed.js';

describe('ollama embedding keepalive', () => {
  it('rewrites only the Ollama OpenAI route and pins keep_alive', () => {
    const adapted = adaptOllamaEmbeddingRequest(
      'http://127.0.0.1:11434/v1/embeddings',
      { model: 'qwen3-embedding:4b', input: 'probe' },
    );
    expect(adapted.url).toBe('http://127.0.0.1:11434/api/embed');
    expect(adapted.body.keep_alive).toBe('5m');
    expect(adapted.body.model).toBe('qwen3-embedding:4b');
    expect(shouldMapOllamaEmbeddingResponse(adapted.url)).toBe(true);
  });

  it('leaves a non-Ollama embeddings endpoint unchanged', () => {
    const body = { model: 'text-embedding-3-small', input: 'probe' };
    const adapted = adaptOllamaEmbeddingRequest('https://api.openai.com/v1/embeddings', body);
    expect(adapted.url).toBe('https://api.openai.com/v1/embeddings');
    expect(adapted.body).toEqual(body);
    expect(shouldMapOllamaEmbeddingResponse(adapted.url)).toBe(false);
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
