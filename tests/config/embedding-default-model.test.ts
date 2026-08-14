import { describe, expect, it } from 'vitest';
import { defaultEmbeddingModelFor } from '../../src/config.js';

/**
 * Embedding default-model exam: pointing the embedding lane at OpenRouter
 * without naming a model must select a model OpenRouter actually serves —
 * qwen3-embedding-8b — instead of the OpenAI-only default. An explicit
 * MEMORIX_EMBEDDING_MODEL always wins. Deterministic, offline.
 */

describe('embedding default model exam', () => {
  it('picks qwen3-embedding-8b for the OpenRouter base URL', () => {
    expect(defaultEmbeddingModelFor('https://openrouter.ai/api/v1', undefined)).toBe('qwen/qwen3-embedding-8b');
    expect(defaultEmbeddingModelFor('https://openrouter.ai/api/v1/', undefined)).toBe('qwen/qwen3-embedding-8b');
  });

  it('keeps the OpenAI default elsewhere', () => {
    expect(defaultEmbeddingModelFor('https://api.openai.com/v1', undefined)).toBe('text-embedding-3-small');
    expect(defaultEmbeddingModelFor(undefined, undefined)).toBe('text-embedding-3-small');
  });

  it('never overrides an explicitly configured model', () => {
    expect(defaultEmbeddingModelFor('https://openrouter.ai/api/v1', 'openai/text-embedding-3-small'))
      .toBe('openai/text-embedding-3-small');
    expect(defaultEmbeddingModelFor('https://api.openai.com/v1', 'qwen/qwen3-embedding-8b'))
      .toBe('qwen/qwen3-embedding-8b');
  });
});
