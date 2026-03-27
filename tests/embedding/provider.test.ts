/**
 * Embedding Provider Tests
 *
 * Tests the embedding abstraction layer with graceful degradation.
 * Since fastembed is an optional dependency, these tests verify
 * that the system works correctly WITHOUT it (fulltext fallback).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock embedding providers to simulate them not being installed
vi.mock('../../src/embedding/fastembed-provider.js', () => {
  throw new Error('fastembed not installed (mocked)');
});
vi.mock('../../src/embedding/transformers-provider.js', () => {
  throw new Error('transformers not installed (mocked)');
});
const mockApiProviderCreate = vi.fn();
vi.mock('../../src/embedding/api-provider.js', () => ({
  APIEmbeddingProvider: {
    create: mockApiProviderCreate,
  },
}));
import { getEmbeddingProvider, isVectorSearchAvailable, resetProvider } from '../../src/embedding/provider.js';
import { resetDb, isEmbeddingEnabled, generateEmbedding, getDb } from '../../src/store/orama-store.js';
import { resetConfigCache } from '../../src/config.js';

// Save and clear embedding-related env vars to prevent real API provider initialization
const savedEnv: Record<string, string | undefined> = {};
const EMBEDDING_ENV_KEYS = [
  'MEMORIX_API_KEY', 'MEMORIX_EMBEDDING', 'MEMORIX_EMBEDDING_API_KEY',
  'MEMORIX_EMBEDDING_BASE_URL', 'MEMORIX_EMBEDDING_MODEL',
  'MEMORIX_LLM_API_KEY', 'OPENAI_API_KEY',
];

beforeEach(() => {
  for (const key of EMBEDDING_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  mockApiProviderCreate.mockReset();
  resetProvider();
  resetDb();
  resetConfigCache();
});

import { afterEach } from 'vitest';
afterEach(() => {
  for (const key of EMBEDDING_ENV_KEYS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    }
  }
  resetConfigCache();
});

describe('Embedding Provider', () => {
  describe('graceful degradation (no fastembed installed)', () => {
    it('should return null provider when fastembed is not installed', async () => {
      const provider = await getEmbeddingProvider();
      // In test environment, fastembed is not installed → null
      expect(provider).toBeNull();
    });

    it('should report vector search as unavailable', async () => {
      const available = await isVectorSearchAvailable();
      expect(available).toBe(false);
    });

    it('should return null for generateEmbedding', async () => {
      const embedding = await generateEmbedding('test text');
      expect(embedding).toBeNull();
    });

    it('should create DB without embedding field in schema', async () => {
      const db = await getDb();
      expect(db).toBeDefined();
      expect(isEmbeddingEnabled()).toBe(false);
    });
  });

  describe('fulltext search still works without embeddings', () => {
    it('should search using fulltext when no embedding provider', async () => {
      const { storeObservation, initObservations } = await import('../../src/memory/observations.js');
      const { compactSearch } = await import('../../src/compact/engine.js');
      const { promises: fs } = await import('node:fs');
      const path = await import('node:path');
      const os = await import('node:os');

      const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-embed-'));
      await resetDb();
      await initObservations(testDir);

      await storeObservation({
        entityName: 'test',
        type: 'decision',
        title: 'Use fastembed for local embeddings',
        narrative: 'Chose fastembed because it runs locally without API',
        projectId: 'test/embed',
      });

      const result = await compactSearch({ query: 'fastembed', projectId: 'test/embed' });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toContain('fastembed');
    });
  });

  describe('provider interface', () => {
    it('should reset cleanly', async () => {
      await getEmbeddingProvider(); // initializes
      resetProvider();
      // Should be re-initializable
      const provider = await getEmbeddingProvider();
      expect(provider).toBeNull(); // still null since providers are mocked out
    });
  });

  describe('auto mode with API config present', () => {
    it('should prefer API embeddings before local fallback providers', async () => {
      process.env.MEMORIX_EMBEDDING = 'auto';
      process.env.MEMORIX_EMBEDDING_API_KEY = 'api-key';
      process.env.MEMORIX_EMBEDDING_BASE_URL = 'https://embeddings.example/v1';
      process.env.MEMORIX_EMBEDDING_MODEL = 'text-embedding-3-small';

      const apiProvider = {
        name: 'api-text-embedding-3-small',
        dimensions: 1536,
        embed: vi.fn(),
        embedBatch: vi.fn(),
      };
      mockApiProviderCreate.mockResolvedValue(apiProvider);

      const provider = await getEmbeddingProvider();

      expect(provider).toBe(apiProvider);
      expect(mockApiProviderCreate).toHaveBeenCalledTimes(1);
    });
  });
});
