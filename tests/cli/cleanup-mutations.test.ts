import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Observation } from '../../src/types.js';
import { applyCleanupMutations } from '../../src/cli/commands/cleanup.js';
import { SqliteBackend } from '../../src/store/sqlite-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

function makeObservation(overrides: Partial<Observation> & { id: number; projectId: string }): Observation {
  return {
    entityName: `entity-${overrides.id}`,
    type: 'discovery',
    title: `Observation ${overrides.id}`,
    narrative: '',
    facts: [],
    filesModified: [],
    concepts: [],
    tokens: 10,
    createdAt: new Date().toISOString(),
    status: 'active',
    source: 'agent',
    ...overrides,
  } as Observation;
}

describe('cleanup persistence', () => {
  let dataDir: string;
  let store: SqliteBackend;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-cleanup-test-'));
    store = new SqliteBackend();
    await store.init(dataDir);
  });

  afterEach(async () => {
    store.close();
    closeAllDatabases();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('archives and deletes selected IDs without a table replacement or stale-field overwrite', async () => {
    const remove = makeObservation({ id: 1, projectId: 'project-a', title: 'remove me' });
    const currentArchive = makeObservation({ id: 2, projectId: 'project-a', title: 'current title' });
    const otherProject = makeObservation({ id: 3, projectId: 'project-b', title: 'keep other project' });
    await store.insert(remove);
    await store.insert(currentArchive);
    await store.insert(otherProject);

    const rawLoadAll = vi.spyOn(store as any, 'rawLoadAll');
    const bulkReplace = vi.spyOn(store, 'bulkReplace');
    const staleArchiveSnapshot = { ...currentArchive, title: 'stale title from preview' };

    const result = await applyCleanupMutations(store, [staleArchiveSnapshot], [remove]);

    expect(result).toEqual({ archived: 1, removed: 1 });
    expect(rawLoadAll).not.toHaveBeenCalled();
    expect(bulkReplace).not.toHaveBeenCalled();

    expect(await store.getById(1)).toBeUndefined();
    expect(await store.getById(2)).toMatchObject({
      status: 'archived',
      title: 'current title',
      projectId: 'project-a',
    });
    expect(await store.getById(3)).toMatchObject({
      status: 'active',
      title: 'keep other project',
      projectId: 'project-b',
    });
  });
});
