import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const homedirMock = vi.hoisted(() => vi.fn(() => ''));

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: homedirMock };
});

const EMBEDDING_ENV_KEYS = [
  'MEMORIX_EMBEDDING_API_KEY',
  'MEMORIX_API_KEY',
  'DASHSCOPE_API_KEY',
  'ALIYUN_API_KEY',
  'MEMORIX_LLM_API_KEY',
  'MEMORIX_LLM_BASE_URL',
  'MEMORIX_EMBEDDING_BASE_URL',
  'MEMORIX_EMBEDDING_MODEL',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
];

let tempHome: string | undefined;

beforeEach(() => {
  vi.resetModules();
  tempHome = mkdtempSync(join(tmpdir(), 'memorix-empty-home-'));
  homedirMock.mockReturnValue(tempHome);
  for (const key of EMBEDDING_ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  vi.resetModules();
  for (const key of EMBEDDING_ENV_KEYS) delete process.env[key];
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  }
  homedirMock.mockReset();
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

  it('uses OPENROUTER_API_KEY for OpenRouter embedding endpoints', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-key';
    process.env.MEMORIX_EMBEDDING_BASE_URL = 'https://openrouter.ai/api/v1';
    process.env.MEMORIX_EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b';
    const { getEmbeddingApiKey } = await import('../../src/config.ts');

    expect(getEmbeddingApiKey()).toBe('openrouter-key');
  });

  it('keeps MEMORIX_EMBEDDING_API_KEY above OPENROUTER_API_KEY', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-key';
    process.env.MEMORIX_EMBEDDING_API_KEY = 'embedding-key';
    process.env.MEMORIX_EMBEDDING_BASE_URL = 'https://openrouter.ai/api/v1';
    const { getEmbeddingApiKey } = await import('../../src/config.ts');

    expect(getEmbeddingApiKey()).toBe('embedding-key');
  });

  it('does not use OPENROUTER_API_KEY for non-OpenRouter embedding endpoints', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-key';
    process.env.MEMORIX_EMBEDDING_BASE_URL = 'https://api.openai.com/v1';
    const { getEmbeddingApiKey } = await import('../../src/config.ts');

    expect(getEmbeddingApiKey()).toBeUndefined();
  });

  it('does not fall back to memory LLM base URL for embedding', async () => {
    process.env.MEMORIX_LLM_BASE_URL = 'https://llm.example/v1';
    const { getEmbeddingBaseUrl } = await import('../../src/config.ts');

    expect(getEmbeddingBaseUrl()).not.toBe('https://llm.example/v1');
  });
});
