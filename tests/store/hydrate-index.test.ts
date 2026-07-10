import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, hydrateIndex, makeOramaObservationId } from '../../src/store/orama-store.js';
import { getByID, insert, search } from '@orama/orama';

// Minimal observation shape matching what hydrateIndex expects
function makeObs(id: number, status: string, title: string) {
  return {
    id,
    projectId: 'test/hydrate-project',
    entityName: `entity-${id}`,
    type: 'discovery',
    title,
    narrative: `Narrative for observation ${id}`,
    facts: ['fact-a'],
    filesModified: [],
    concepts: ['test'],
    tokens: 100,
    createdAt: new Date().toISOString(),
    accessCount: 0,
    lastAccessedAt: '',
    status,
    source: 'agent',
  };
}

describe('hydrateIndex – status handling', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('indexes active, resolved, AND archived observations', async () => {
    const observations = [
      makeObs(1, 'active', 'Active observation'),
      makeObs(2, 'resolved', 'Resolved observation'),
      makeObs(3, 'archived', 'Archived observation'),
    ];

    const inserted = await hydrateIndex(observations);
    expect(inserted).toBe(3);
  });

  it('stores the status field faithfully in the index', async () => {
    const observations = [
      makeObs(10, 'active', 'Status active entry'),
      makeObs(11, 'resolved', 'Status resolved entry'),
      makeObs(12, 'archived', 'Status archived entry'),
    ];

    await hydrateIndex(observations);

    // Import getDb dynamically to access the raw database for verification
    const { getDb } = await import('../../src/store/orama-store.js');
    const db = await getDb();

    // Search for each status value to confirm they're indexed
    const activeHits = await search(db, { term: 'Status active entry', properties: ['title'] });
    const resolvedHits = await search(db, { term: 'Status resolved entry', properties: ['title'] });
    const archivedHits = await search(db, { term: 'Status archived entry', properties: ['title'] });

    expect(activeHits.count).toBeGreaterThanOrEqual(1);
    expect(resolvedHits.count).toBeGreaterThanOrEqual(1);
    expect(archivedHits.count).toBeGreaterThanOrEqual(1);
  });

  it('skips malformed observations without crashing', async () => {
    const observations = [
      makeObs(20, 'active', 'Good observation'),
      null,
      { id: null, projectId: 'x' },
      { id: 21 }, // missing projectId
      makeObs(22, 'resolved', 'Another good one'),
    ];

    const inserted = await hydrateIndex(observations as any[]);
    expect(inserted).toBe(2);
  });

  it('hydrates missing observations when a mini-skill already populated the index', async () => {
    const observations = [
      makeObs(30, 'active', 'First hydration'),
      makeObs(31, 'resolved', 'First hydration resolved'),
    ];

    const { getDb } = await import('../../src/store/orama-store.js');
    const db = await getDb();
    await insert(db, {
      id: 'skill:test%2Fhydrate-project:1',
      observationId: 1,
      entityName: 'test-skill',
      type: 'mini-skill',
      title: 'Preloaded mini-skill',
      narrative: 'This document makes the shared index non-empty.',
      facts: '',
      filesModified: '',
      concepts: 'hydration',
      tokens: 10,
      createdAt: new Date().toISOString(),
      projectId: 'test/hydrate-project',
      accessCount: 0,
      lastAccessedAt: '',
      status: 'active',
      source: 'agent',
      sourceDetail: 'explicit',
      valueCategory: 'core',
      documentType: 'mini-skill',
      knowledgeLayer: 'promoted',
    });

    const first = await hydrateIndex(observations);
    expect(first).toBe(2);

    const second = await hydrateIndex(observations);
    expect(second).toBe(0);

    expect(getByID(db, makeOramaObservationId('test/hydrate-project', 30))).toBeDefined();
    expect(getByID(db, makeOramaObservationId('test/hydrate-project', 31))).toBeDefined();
  });
});
