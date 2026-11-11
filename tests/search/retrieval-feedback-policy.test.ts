import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getByID } from '@orama/orama';
import { compactSearch } from '../../src/compact/engine.js';
import { MemoryFeedbackStore } from '../../src/memory/feedback.js';
import { initObservations, resetObservationRuntime, storeObservation } from '../../src/memory/observations.js';
import { retrievalFacade } from '../../src/search/retrieval-facade.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { getDb, makeOramaObservationId, resetDb, searchObservations } from '../../src/store/orama-store.js';

describe('retrieval feedback policy', () => {
  let dataDir = '';
  let defaultDir = '';
  let originalDataDir: string | undefined;
  let originalEmbedding: string | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-retrieval-bound-'));
    defaultDir = await mkdtemp(path.join(tmpdir(), 'memorix-retrieval-decoy-'));
    originalDataDir = process.env.MEMORIX_DATA_DIR;
    originalEmbedding = process.env.MEMORIX_EMBEDDING;
    process.env.MEMORIX_DATA_DIR = defaultDir;
    process.env.MEMORIX_EMBEDDING = 'off';
    await resetDb();
    resetObservationRuntime();
    resetObservationStore();
    closeAllDatabases();
    await initObservations(dataDir);
  });

  afterEach(async () => {
    await resetDb();
    resetObservationRuntime();
    resetObservationStore();
    closeAllDatabases();
    if (originalDataDir === undefined) delete process.env.MEMORIX_DATA_DIR;
    else process.env.MEMORIX_DATA_DIR = originalDataDir;
    if (originalEmbedding === undefined) delete process.env.MEMORIX_EMBEDDING;
    else process.env.MEMORIX_EMBEDDING = originalEmbedding;
    await rm(dataDir, { recursive: true, force: true });
    await rm(defaultDir, { recursive: true, force: true });
  });

  it('applies feedback from the bound store and reports omitted results', async () => {
    const { observation } = await storeObservation({
      projectId: 'org/repo', entityName: 'auth', type: 'decision',
      title: 'Reversible authentication policy', narrative: 'Use a reviewable auth decision.',
    });
    const feedback = new MemoryFeedbackStore();
    await feedback.init(dataDir);
    for (let index = 0; index < 2; index++) {
      feedback.record({
        projectId: 'org/repo', candidateKind: 'observation',
        candidateId: String(observation.id), signal: 'user-correction',
        sourceRef: `test:correction:${index}`,
      });
    }

    const compact = await compactSearch({ query: 'Reversible authentication', projectId: 'org/repo' });
    expect(compact.entries).toEqual([]);
    expect(compact.receipt.candidateCount).toBeGreaterThan(0);
    expect(compact.receipt.selectedCount).toBe(0);
    expect(compact.receipt.omittedCount).toBe(compact.receipt.candidateCount);
    expect(compact.receipt.omittedByFeedback).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const indexed = getByID(await getDb(), makeOramaObservationId('org/repo', observation.id)) as { accessCount?: number } | undefined;
    expect(indexed?.accessCount ?? 0).toBe(0);

    const direct = await retrievalFacade.search({ query: 'Reversible authentication', projectId: 'org/repo' });
    expect(direct.entries).toEqual([]);
    expect(direct.receipt.selectedCount).toBe(0);
    expect(direct.receipt.omittedByFeedback).toBe(1);

    const all = await retrievalFacade.search({ query: 'Reversible authentication', projectId: 'org/repo', status: 'all' });
    expect(all.entries).toEqual([expect.objectContaining({ id: observation.id, feedbackStatus: 'archived' })]);
  });

  it('keeps access tracking on the legacy array search API', async () => {
    const { observation } = await storeObservation({
      projectId: 'org/repo', entityName: 'auth', type: 'decision',
      title: 'Legacy search access policy', narrative: 'Only delivered records count as accessed.',
    });
    const results = await searchObservations({ query: 'Legacy search access', projectId: 'org/repo' });
    expect(results).toEqual([expect.objectContaining({ id: observation.id })]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const indexed = getByID(await getDb(), makeOramaObservationId('org/repo', observation.id)) as { accessCount?: number } | undefined;
    expect(indexed?.accessCount).toBe(1);
  });
});
