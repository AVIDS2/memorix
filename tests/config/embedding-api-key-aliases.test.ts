import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const EMBEDDING_ENV_KEYS = [
  'MEMORIX_EMBEDDING_API_KEY',
  'MEMORIX_API_KEY',
  'DASHSCOPE_API_KEY',
  'ALIYUN_API_KEY',
  'MEMORIX_LLM_API_KEY',
  'MEMORIX_LLM_BASE_URL',
  'MEMORIX_EMBEDDING_BASE_URL',
  'OPENAI_API_KEY',
];

beforeEach(() => {
  vi.resetModules();
  for (const key of EMBEDDING_ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  vi.resetModules();
  for (const key of EMBEDDING_ENV_KEYS) delete process.env[key];
});

describe('embedding API key lane isolation', () => {
  it('does not fall back to DASHSCOPE_API_KEY', async () => {
    process.env.DASHSCOPE_API_KEY = 'dashscope-key';
    const { getEmbeddingApiKey } = await import('../../src/config.ts');

    expect(getEmbeddingApiKey()).toBeUndefined();
  });

  it('does not fall back to ALIYUN_API_KEY', async () => {
    process.env.ALIYUN_API_KEY = 'aliyun-key';
    const { getEmbeddingApiKey } = await import('../../src/config.ts');

    expect(getEmbeddingApiKey()).toBeUndefined();
  });

  it('uses MEMORIX_EMBEDDING_API_KEY for embedding', async () => {
    process.env.MEMORIX_EMBEDDING_API_KEY = 'memorix-embed-key';
    process.env.DASHSCOPE_API_KEY = 'dashscope-key';
    process.env.ALIYUN_API_KEY = 'aliyun-key';
    const { getEmbeddingApiKey } = await import('../../src/config.ts');

    expect(getEmbeddingApiKey()).toBe('memorix-embed-key');
  });

  it('does not use MEMORIX_API_KEY for embedding', async () => {
    process.env.MEMORIX_API_KEY = 'memory-llm-key';
    process.env.MEMORIX_EMBEDDING_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const { getEmbeddingApiKey } = await import('../../src/config.ts');

    expect(getEmbeddingApiKey()).toBeUndefined();
  });

  it('does not let MEMORIX_API_KEY shadow the embedding lane key', async () => {
    process.env.MEMORIX_API_KEY = 'memory-llm-key';
    process.env.MEMORIX_EMBEDDING_API_KEY = 'embedding-key';
    process.env.MEMORIX_EMBEDDING_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const { getEmbeddingApiKey } = await import('../../src/config.ts');

    expect(getEmbeddingApiKey()).toBe('embedding-key');
  });

  it('does not fall back to memory LLM API key for embedding', async () => {
    process.env.MEMORIX_LLM_API_KEY = 'memory-llm-key';
    process.env.MEMORIX_EMBEDDING_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const { getEmbeddingApiKey } = await import('../../src/config.ts');

    expect(getEmbeddingApiKey()).toBeUndefined();
  });

  it('does not fall back to OPENAI_API_KEY for embedding', async () => {
    process.env.OPENAI_API_KEY = 'openai-key';
    const { getEmbeddingApiKey } = await import('../../src/config.ts');

    expect(getEmbeddingApiKey()).toBeUndefined();
  });

  it('does not fall back to memory LLM base URL for embedding', async () => {
    process.env.MEMORIX_LLM_BASE_URL = 'https://llm.example/v1';
    const { getEmbeddingBaseUrl } = await import('../../src/config.ts');

    expect(getEmbeddingBaseUrl()).not.toBe('https://llm.example/v1');
  });
});
