import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockProvider = {
  name: 'mock-api',
  dimensions: 2,
  async embed(text: string): Promise<number[]> {
    const q = text.toLowerCase();
    if (q.includes('why did semantic retrieval get weaker')) {
      return [1, 0];
    }
    return [0, 1];
  },
  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  },
};

const mockCallLLM = vi.fn(async () => ({ content: 'why did semantic retrieval get weaker' }));
const mockIsLLMEnabled = vi.fn(() => true);
const mockInitLLM = vi.fn(() => ({
  provider: 'openai',
  apiKey: 'test',
  model: 'mock',
  baseUrl: 'https://api.test.com/v1',
}));

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: vi.fn(async () => mockProvider),
  isEmbeddingExplicitlyDisabled: vi.fn(() => true),
  resetProvider: vi.fn(),
}));

vi.mock('../../src/llm/provider.js', () => ({
  callLLM: mockCallLLM,
  isLLMEnabled: mockIsLLMEnabled,
  initLLM: mockInitLLM,
}));

describe('orama-store semantic hybrid search', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockCallLLM.mockClear();
    mockIsLLMEnabled.mockClear();
    mockInitLLM.mockClear();
    const { resetDb } = await import('../../src/store/orama-store.js');
    await resetDb();
  });

  it('keeps a semantically correct english paraphrase result in hybrid mode', async () => {
    const {
      insertObservation,
      makeOramaObservationId,
      searchObservations,
    } = await import('../../src/store/orama-store.js');

    const recent = new Date().toISOString();
    const old = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();

    await insertObservation({
      id: makeOramaObservationId('AVIDS2/memorix', 1),
      observationId: 1,
      entityName: 'search-quality',
      type: 'discovery',
      title: 'Search quality regression after vector gate',
      narrative: 'Memorix search felt weaker after the semantic score gate became too strict.',
      facts: 'DashScope embeddings were present but the right memory stayed hidden.',
      filesModified: 'src/store/orama-store.ts',
      concepts: 'semantic-search\nthreshold\nmemorix',
      tokens: 48,
      createdAt: recent,
      projectId: 'AVIDS2/memorix',
      accessCount: 0,
      lastAccessedAt: recent,
      status: 'active',
      source: 'agent',
      embedding: [0.49, 0.871722],
    });

    await insertObservation({
      id: makeOramaObservationId('AVIDS2/memorix', 2),
      observationId: 2,
      entityName: 'jwt-auth',
      type: 'problem-solution',
      title: 'Why did semantic retrieval get weaker in JWT auth',
      narrative: 'Memorix JWT auth debugging notes with many exact query words but unrelated semantics.',
      facts: 'This should not outrank the true semantic match.',
      filesModified: 'src/auth/jwt.ts',
      concepts: 'jwt\nauth\nmemorix',
      tokens: 51,
      createdAt: old,
      projectId: 'AVIDS2/memorix',
      accessCount: 0,
      lastAccessedAt: old,
      status: 'active',
      source: 'agent',
      embedding: [0.1, 0.994987],
    });

    const entries = await searchObservations({
      query: 'why did semantic retrieval get weaker',
      projectId: 'AVIDS2/memorix',
      limit: 5,
    });

    expect(entries[0]?.id).toBe(1);
    expect(entries[0]?.title).toContain('vector gate');
  });

  it('keeps vector/hybrid results inside the requested project', async () => {
    const {
      insertObservation,
      makeOramaObservationId,
      searchObservations,
    } = await import('../../src/store/orama-store.js');

    const now = new Date().toISOString();

    await insertObservation({
      id: makeOramaObservationId('AVIDS2/memorix', 10),
      observationId: 10,
      entityName: 'semantic-quality',
      type: 'discovery',
      title: 'DashScope config restored but semantic retrieval weak',
      narrative: 'Memorix semantic retrieval weakened after the vector gate became too strict.',
      facts: 'This is the current project result we want to keep.',
      filesModified: 'src/store/orama-store.ts',
      concepts: 'semantic-search\nmemorix',
      tokens: 40,
      createdAt: now,
      projectId: 'AVIDS2/memorix',
      accessCount: 0,
      lastAccessedAt: now,
      status: 'active',
      source: 'agent',
      embedding: [0.6, 0.8],
    });

    await insertObservation({
      id: makeOramaObservationId('AVIDS2/test-memorix-demo', 11),
      observationId: 11,
      entityName: 'semantic-quality',
      type: 'discovery',
      title: '测试 v0.7.4 连字符搜索修复',
      narrative: 'Another project with a deceptively similar vector.',
      facts: 'Cross-project leakage should be filtered out.',
      filesModified: 'src/demo/search.ts',
      concepts: 'semantic-search\ndemo',
      tokens: 40,
      createdAt: now,
      projectId: 'AVIDS2/test-memorix-demo',
      accessCount: 0,
      lastAccessedAt: now,
      status: 'active',
      source: 'agent',
      embedding: [0.58, 0.814616],
    });

    const entries = await searchObservations({
      query: '语义检索为什么变弱',
      projectId: 'AVIDS2/memorix',
      limit: 5,
    });

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.projectId === 'AVIDS2/memorix')).toBe(true);
    expect(entries[0]?.id).toBe(10);
  });

  it('downranks command-log memories for natural-language semantic queries', async () => {
    const {
      insertObservation,
      makeOramaObservationId,
      searchObservations,
    } = await import('../../src/store/orama-store.js');

    const now = new Date().toISOString();

    await insertObservation({
      id: makeOramaObservationId('AVIDS2/memorix', 20),
      observationId: 20,
      entityName: 'semantic-quality',
      type: 'discovery',
      title: 'DashScope config restored but semantic retrieval weak',
      narrative: 'Memorix semantic retrieval quality dropped after the vector gate got too strict.',
      facts: 'This is the meaningful natural-language memory.',
      filesModified: 'src/store/orama-store.ts',
      concepts: 'semantic-search\nmemorix',
      tokens: 40,
      createdAt: now,
      projectId: 'AVIDS2/memorix',
      accessCount: 0,
      lastAccessedAt: now,
      status: 'active',
      source: 'agent',
      embedding: [0.6, 0.8],
    });

    await insertObservation({
      id: makeOramaObservationId('AVIDS2/memorix', 21),
      observationId: 21,
      entityName: 'command-log',
      type: 'what-changed',
      title: 'Ran: git add -A; git commit -m "fix semantic retrieval"',
      narrative: 'A command trace with strong lexical overlap but lower semantic value.',
      facts: 'Useful for audit trail, but should not dominate a natural-language why query.',
      filesModified: 'src/store/orama-store.ts',
      concepts: 'semantic-search\ngit',
      tokens: 40,
      createdAt: now,
      projectId: 'AVIDS2/memorix',
      accessCount: 0,
      lastAccessedAt: now,
      status: 'active',
      source: 'agent',
      embedding: [0.58, 0.814616],
    });

    const entries = await searchObservations({
      query: '语义检索为什么变弱',
      projectId: 'AVIDS2/memorix',
      limit: 5,
    });

    expect(entries[0]?.id).toBe(20);
    expect(entries[0]?.title).toContain('semantic retrieval weak');
  });

  it('expands CJK natural-language queries to recover cross-lingual memories', async () => {
    const {
      insertObservation,
      makeOramaObservationId,
      searchObservations,
    } = await import('../../src/store/orama-store.js');

    const now = new Date().toISOString();

    await insertObservation({
      id: makeOramaObservationId('AVIDS2/memorix', 30),
      observationId: 30,
      entityName: 'semantic-quality',
      type: 'discovery',
      title: 'DashScope config restored but semantic retrieval weak',
      narrative: 'Memorix semantic retrieval quality dropped after the vector gate got too strict.',
      facts: 'This is the English memory we want a Chinese query to recover.',
      filesModified: 'src/store/orama-store.ts',
      concepts: 'semantic-search\nmemorix',
      tokens: 40,
      createdAt: now,
      projectId: 'AVIDS2/memorix',
      accessCount: 0,
      lastAccessedAt: now,
      status: 'active',
      source: 'agent',
      embedding: [1, 0],
    });

    await insertObservation({
      id: makeOramaObservationId('AVIDS2/memorix', 31),
      observationId: 31,
      entityName: 'command-log',
      type: 'what-changed',
      title: 'Ran: git commit -m \"fix semantic retrieval\"',
      narrative: 'A command trace with some lexical overlap.',
      facts: 'Useful for audit history, but not the best answer.',
      filesModified: 'src/store/orama-store.ts',
      concepts: 'semantic-search\ngit',
      tokens: 40,
      createdAt: now,
      projectId: 'AVIDS2/memorix',
      accessCount: 0,
      lastAccessedAt: now,
      status: 'active',
      source: 'agent',
      embedding: [0, 1],
    });

    const entries = await searchObservations({
      query: '语义检索为什么变弱',
      projectId: 'AVIDS2/memorix',
      limit: 5,
    });

    expect(mockCallLLM).toHaveBeenCalled();
    expect(entries[0]?.id).toBe(30);
    expect(entries[0]?.title).toContain('semantic retrieval weak');
  });
});
