import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getByID, update } from '@orama/orama';

const embedding = vi.hoisted(() => ({
  getEmbeddingProvider: vi.fn(),
}));

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: embedding.getEmbeddingProvider,
}));

import {
  getDb,
  getDeferredCachedVectorHydration,
  hasObservationVector,
  hydrateIndex,
  hydrateIndexForStartup,
  makeOramaObservationId,
  resetDb,
} from '../../src/store/orama-store.js';

function makeObservation(id: number) {
  return {
    id,
    projectId: 'test/cache-hydration',
    entityName: 'cache-hydration',
    type: 'discovery',
    title: 'Cached semantic memory',
    narrative: 'Restored immediately without a network embedding request',
    facts: ['cached vector', 'cold start'],
    filesModified: [],
    concepts: [],
    tokens: 12,
    createdAt: new Date().toISOString(),
    accessCount: 0,
    lastAccessedAt: '',
    status: 'active',
    source: 'agent',
  };
}

function makeProvider(cachedVectors: (number[] | null)[]) {
  return {
    name: 'api-test',
    dimensions: 3,
    embed: vi.fn(),
    embedBatch: vi.fn(),
    getCachedEmbeddings: vi.fn().mockResolvedValue(cachedVectors),
  };
}

describe('hydrateIndex cached vectors', () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it('restores compatible cached vectors without asking the provider to generate them', async () => {
    const vector = [0.1, 0.2, 0.3];
    const provider = makeProvider([vector]);
    embedding.getEmbeddingProvider.mockResolvedValue(provider);
    const observation = makeObservation(1);

    await hydrateIndex([observation]);

    const db = await getDb();
    const document = getByID(db, makeOramaObservationId(observation.projectId, observation.id)) as {
      embedding?: number[];
    };
    expect(document.embedding).toEqual(vector);
    expect(provider.getCachedEmbeddings).toHaveBeenCalledWith([
      'Cached semantic memory Restored immediately without a network embedding request cached vector cold start',
    ]);
    expect(provider.embed).not.toHaveBeenCalled();
    expect(provider.embedBatch).not.toHaveBeenCalled();
    expect(hasObservationVector(observation.projectId, observation.id)).toBe(true);
  });

  it('keeps a cache miss lexical-only without triggering a remote embedding request', async () => {
    const provider = makeProvider([null]);
    embedding.getEmbeddingProvider.mockResolvedValue(provider);
    const observation = makeObservation(2);

    await hydrateIndex([observation]);

    expect(provider.embed).not.toHaveBeenCalled();
    expect(provider.embedBatch).not.toHaveBeenCalled();
    expect(hasObservationVector(observation.projectId, observation.id)).toBe(false);
  });

  it('keeps malformed cached vectors out of the index without losing lexical recall', async () => {
    const provider = makeProvider([[0.1, Number.NaN, 0.3]]);
    embedding.getEmbeddingProvider.mockResolvedValue(provider);
    const observation = makeObservation(4);

    await hydrateIndex([observation]);

    const db = await getDb();
    const document = getByID(db, makeOramaObservationId(observation.projectId, observation.id)) as {
      embedding?: number[];
      title: string;
    };
    expect(document.title).toBe(observation.title);
    expect(document.embedding).toBeUndefined();
    expect(hasObservationVector(observation.projectId, observation.id)).toBe(false);
    expect(provider.embed).not.toHaveBeenCalled();
    expect(provider.embedBatch).not.toHaveBeenCalled();
  });

  it('lets startup become lexical-ready before a slow disk cache restores vectors', async () => {
    let resolveCache!: (vectors: (number[] | null)[]) => void;
    const cachePromise = new Promise<(number[] | null)[]>((resolve) => {
      resolveCache = resolve;
    });
    const vector = [0.1, 0.2, 0.3];
    const provider = makeProvider([]);
    provider.getCachedEmbeddings.mockReturnValue(cachePromise);
    embedding.getEmbeddingProvider.mockResolvedValue(provider);
    const observation = makeObservation(3);

    const inserted = await hydrateIndex([observation], {
      allowNetworkProbe: false,
      deferCachedVectors: true,
    });

    expect(inserted).toBe(1);
    expect(embedding.getEmbeddingProvider).toHaveBeenCalledWith({ allowNetworkProbe: false });
    expect(hasObservationVector(observation.projectId, observation.id)).toBe(false);
    expect(provider.embed).not.toHaveBeenCalled();
    expect(provider.embedBatch).not.toHaveBeenCalled();

    resolveCache([vector]);
    await getDeferredCachedVectorHydration();

    expect(hasObservationVector(observation.projectId, observation.id)).toBe(true);
  });

  it('keeps the startup index when a normal database request arrives concurrently', async () => {
    let resolveStartup!: (provider: null) => void;
    let resolveNormal!: (provider: ReturnType<typeof makeProvider>) => void;
    const startupProvider = new Promise<null>((resolve) => {
      resolveStartup = resolve;
    });
    const normalProvider = new Promise<ReturnType<typeof makeProvider>>((resolve) => {
      resolveNormal = resolve;
    });
    embedding.getEmbeddingProvider.mockImplementation((options?: { allowNetworkProbe?: boolean }) =>
      options?.allowNetworkProbe === false ? startupProvider : normalProvider,
    );
    const observation = makeObservation(6);

    const startupHydration = hydrateIndexForStartup([observation]);
    const normalDatabase = getDb();

    resolveStartup(null);
    await startupHydration;
    resolveNormal(makeProvider([[0.1, 0.2, 0.3]]));
    await normalDatabase;

    const activeDatabase = await getDb();
    const document = getByID(activeDatabase, makeOramaObservationId(observation.projectId, observation.id)) as {
      title?: string;
    } | undefined;
    expect(document?.title).toBe(observation.title);
    expect(embedding.getEmbeddingProvider).toHaveBeenCalledTimes(1);
    expect(embedding.getEmbeddingProvider).toHaveBeenCalledWith({ allowNetworkProbe: false });
  });

  it('does not attach an old cached vector after the observation changed during cache loading', async () => {
    let resolveCache!: (vectors: (number[] | null)[]) => void;
    const cachePromise = new Promise<(number[] | null)[]>((resolve) => {
      resolveCache = resolve;
    });
    const provider = makeProvider([]);
    provider.getCachedEmbeddings.mockReturnValue(cachePromise);
    embedding.getEmbeddingProvider.mockResolvedValue(provider);
    const observation = makeObservation(5);

    await hydrateIndex([observation], {
      allowNetworkProbe: false,
      deferCachedVectors: true,
    });

    const db = await getDb();
    const id = makeOramaObservationId(observation.projectId, observation.id);
    const current = getByID(db, id) as Record<string, unknown>;
    await update(db, id, {
      ...current,
      narrative: 'The observation changed while the cache was loading',
    } as any);

    resolveCache([[0.1, 0.2, 0.3]]);
    await getDeferredCachedVectorHydration();

    expect(hasObservationVector(observation.projectId, observation.id)).toBe(false);
  });
});
