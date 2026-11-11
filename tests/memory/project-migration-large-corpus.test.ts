import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  initObservations,
  migrateProjectIds,
  resetObservationRuntime,
  getAllObservations,
} from '../../src/memory/observations.js';
import {
  getObservationStore,
  initObservationStore,
  resetObservationStore,
} from '../../src/store/obs-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import type { Observation } from '../../src/types.js';

function observation(): Observation {
  return {
    id: 1,
    entityName: 'large-alias-project',
    type: 'discovery',
    title: 'Large corpus alias migration',
    narrative: 'Project identity migration must not require full hydration.',
    facts: [],
    filesModified: [],
    concepts: [],
    tokens: 12,
    createdAt: '2026-10-11T00:00:00.000Z',
    projectId: 'local/project-a',
    status: 'active',
  };
}

describe('large-corpus project migration', () => {
  let dataDir = '';
  const previousThreshold = process.env.MEMORIX_ORAMA_HYDRATION_THRESHOLD;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-large-migration-'));
    process.env.MEMORIX_ORAMA_HYDRATION_THRESHOLD = '1';
    const store = await initObservationStore(dataDir);
    await store.insert(observation());
  });

  afterEach(async () => {
    resetObservationRuntime();
    resetObservationStore();
    closeAllDatabases();
    if (previousThreshold === undefined) delete process.env.MEMORIX_ORAMA_HYDRATION_THRESHOLD;
    else process.env.MEMORIX_ORAMA_HYDRATION_THRESHOLD = previousThreshold;
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    dataDir = '';
  });

  it('migrates from SQLite while lazy mode keeps the in-memory corpus empty', async () => {
    await initObservations(dataDir);
    expect(getAllObservations()).toEqual([]);

    await expect(migrateProjectIds(['project-a', 'local/project-a'], 'project-a')).resolves.toBe(1);
    await expect(getObservationStore().loadAll()).resolves.toEqual([
      expect.objectContaining({ id: 1, projectId: 'project-a' }),
    ]);
  });
});
