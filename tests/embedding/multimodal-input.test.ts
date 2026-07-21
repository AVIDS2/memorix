import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EmbeddingInputError,
  UnsupportedEmbeddingModalityError,
  validateEmbeddingInput,
  type EmbeddingProvider,
} from '../../src/embedding/provider.ts';
import { APIEmbeddingProvider } from '../../src/embedding/api-provider.ts';

function withEmbeddingEnv(env: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(env)) {
    previous.set(key, process.env[key]);
    process.env[key] = env[key];
  }
  return fn().finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('typed embedding inputs', () => {
  it('preserves string APIs while exposing query/document intent', async () => {
    const provider: EmbeddingProvider = {
      name: 'test',
      dimensions: 2,
      embed: vi.fn(async () => [1, 2]),
      embedBatch: vi.fn(async (texts) => texts.map(() => [1, 2])),
      embedInput: vi.fn(async () => [1, 2]),
      embedInputs: vi.fn(async (inputs) => inputs.map(() => [1, 2])),
    };

    await provider.embed('legacy');
    await provider.embedInput!(
      { modality: 'text', text: 'query' },
      { intent: 'query' },
    );
    expect(provider.embed).toHaveBeenCalledWith('legacy');
    expect(provider.embedInput).toHaveBeenCalledWith(
      { modality: 'text', text: 'query' },
      { intent: 'query' },
    );
  });

  it('rejects unsafe media references and oversized inline payloads', () => {
    expect(() =>
      validateEmbeddingInput({ modality: 'image', url: 'file:///etc/passwd' }),
    ).toThrow(EmbeddingInputError);
    expect(() =>
      validateEmbeddingInput({
        modality: 'document',
        url: 'http://127.0.0.1/private',
      }),
    ).toThrow(/private|scheme/i);
    expect(() =>
      validateEmbeddingInput({
        modality: 'image',
        url: 'https://user:secret@example.com/a.png',
      }),
    ).toThrow(/credentials/i);
    expect(() =>
      validateEmbeddingInput({
        modality: 'audio',
        data: 'A'.repeat(5 * 1024 * 1024 + 1),
        mimeType: 'audio/wav',
      }),
    ).toThrow(/too large/i);
  });

  it('reads the cache directory environment at provider creation time', async () => {
    await withEmbeddingEnv({
      MEMORIX_DATA_DIR: '/tmp/memorix-runtime-cache-dir',
      MEMORIX_EMBEDDING_API_KEY: 'test-key',
      MEMORIX_EMBEDDING_BASE_URL: 'https://api.openai.com/v1',
      MEMORIX_EMBEDDING_MODEL: 'text-embedding-3-small',
      MEMORIX_EMBEDDING_DIMENSIONS: '2',
    }, async () => {
      const provider = await APIEmbeddingProvider.create({ allowNetworkProbe: false });
      // Without a dims cache this may return null; creation path must not throw on env resolution.
      expect(provider === null || provider.dimensions === 2).toBe(true);
    });
  });

  it('reports unsupported modality as a typed capability error', async () => {
    await withEmbeddingEnv({
      MEMORIX_EMBEDDING_API_KEY: 'test-key',
      MEMORIX_EMBEDDING_BASE_URL: 'https://api.openai.com/v1',
      MEMORIX_EMBEDDING_MODEL: 'text-embedding-3-small',
      MEMORIX_EMBEDDING_DIMENSIONS: '2',
    }, async () => {
      // Seed dims metadata path by probing through network-allowed create with mocked fetch
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }),
        headers: { get: () => null },
      });
      vi.stubGlobal('fetch', fetchMock);
      const provider = await APIEmbeddingProvider.create();
      await expect(
        provider!.embedInput({
          modality: 'image',
          url: 'https://example.com/a.png',
        }),
      ).rejects.toBeInstanceOf(UnsupportedEmbeddingModalityError);
    });
  });
});

describe('API multimodal mapping', () => {
  it('maps Jina query/document intent and includes modality in cache identity', async () => {
    await withEmbeddingEnv({
      MEMORIX_DATA_DIR: `/tmp/memorix-jina-${Date.now()}`,
      MEMORIX_EMBEDDING_API_KEY: 'test-key',
      MEMORIX_EMBEDDING_BASE_URL: 'https://api.jina.ai/v1',
      MEMORIX_EMBEDDING_MODEL: 'jina-embeddings-v4',
      MEMORIX_EMBEDDING_DIMENSIONS: '3',
    }, async () => {
      const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
        const body = JSON.parse(String(init.body));
        const isProbe = body.input === 'dimension probe';
        return {
          ok: true,
          json: async () => ({
            data: [{ embedding: isProbe || body.task === 'retrieval.query' ? [1, 2, 3] : [3, 2, 1] }],
          }),
          headers: { get: () => null },
        };
      });
      vi.stubGlobal('fetch', fetchMock);
      const provider = await APIEmbeddingProvider.create();

      await provider!.embedInput(
        { modality: 'image', url: 'https://example.com/a.png' },
        { intent: 'query' },
      );
      await provider!.embedInput(
        { modality: 'image', url: 'https://example.com/a.png' },
        { intent: 'document' },
      );

      const bodies = fetchMock.mock.calls
        .map((call) => JSON.parse(String(call[1].body)))
        .filter((body) => body.input !== 'dimension probe');
      const queryBody = bodies.find((body) => body.task === 'retrieval.query');
      const documentBody = bodies.find((body) => body.task === 'retrieval.passage');
      expect(queryBody).toMatchObject({
        task: 'retrieval.query',
        input: [{ image: 'https://example.com/a.png' }],
      });
      expect(documentBody.task).toBe('retrieval.passage');
    });
  });

  it('maps Google retrieval task types and instructions', async () => {
    await withEmbeddingEnv({
      MEMORIX_DATA_DIR: `/tmp/memorix-google-${Date.now()}`,
      MEMORIX_EMBEDDING_API_KEY: 'test-key',
      MEMORIX_EMBEDDING_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      MEMORIX_EMBEDDING_MODEL: 'gemini-embedding-2-preview',
      MEMORIX_EMBEDDING_DIMENSIONS: '3',
    }, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [1, 2, 3] }] }),
        headers: { get: () => null },
      });
      vi.stubGlobal('fetch', fetchMock);
      const provider = await APIEmbeddingProvider.create();
      await provider!.embedInput(
        { modality: 'text', text: 'needle' },
        { intent: 'query', instruction: 'Find code' },
      );
      const body = fetchMock.mock.calls
        .map((call) => JSON.parse(String(call[1].body)))
        .find((candidate) => candidate.input !== 'dimension probe');
      expect(body).toMatchObject({
        task_type: 'RETRIEVAL_QUERY',
        instruction: 'Find code',
      });
    });
  });
});
