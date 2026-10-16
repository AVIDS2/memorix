import { create, insert, search } from '@orama/orama';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSearchTokenizer } from '../../src/store/orama-store.js';

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: vi.fn(async () => null),
  isEmbeddingExplicitlyDisabled: vi.fn(() => true),
  resetProvider: vi.fn(),
}));

describe('Orama CJK tokenizer', () => {
  beforeEach(async () => {
    const { resetDb } = await import('../../src/store/orama-store.js');
    await resetDb();
  });

  it('indexes and searches CJK exact text and substrings', async () => {
    const tokenizer = createSearchTokenizer();
    const database = await create({
      schema: { title: 'string' },
      components: { tokenizer },
    });

    await insert(database, { title: '缓存过期时间设置' });
    await insert(database, { title: 'テスト設定' });

    expect(search(database, { term: '缓存过期时间设置', properties: ['title'] }))
      .toMatchObject({ count: 1 });
    expect(search(database, { term: '缓存', properties: ['title'] }))
      .toMatchObject({ count: 1 });
    expect(search(database, { term: 'テスト', properties: ['title'] }))
      .toMatchObject({ count: 1 });
  });

  it('keeps the default Latin token behavior in mixed text', () => {
    const tokens = createSearchTokenizer().tokenize('cache 缓存 timeout');

    expect(tokens).toEqual(expect.arrayContaining(['cache', 'timeout', '缓存']));
  });

  it('uses the tokenizer in the observation search path without embeddings', async () => {
    const { insertObservation, makeOramaObservationId, searchObservations } =
      await import('../../src/store/orama-store.js');
    const now = new Date().toISOString();

    await insertObservation({
      id: makeOramaObservationId('cjk-project', 1),
      observationId: 1,
      entityName: '缓存模块',
      type: 'gotcha',
      title: '缓存过期时间设置',
      narrative: '缓存过期时间设置为三十分钟。',
      facts: 'ttl=30m',
      filesModified: 'src/cache.ts',
      concepts: '缓存\nTTL',
      tokens: 20,
      createdAt: now,
      projectId: 'cjk-project',
      accessCount: 0,
      lastAccessedAt: now,
      status: 'active',
      source: 'agent',
    });

    const entries = await searchObservations({
      query: '缓存',
      projectId: 'cjk-project',
      limit: 5,
    });

    expect(entries[0]?.title).toBe('缓存过期时间设置');
  });
});
