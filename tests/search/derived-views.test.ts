import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFtsDerivedView } from '../../src/search/fts-view.js';
import { createOramaDerivedView } from '../../src/search/orama-view.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { initObservations, resetObservationRuntime } from '../../src/memory/observations.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { resetDb } from '../../src/store/orama-store.js';

describe('derived views', () => {
  let dataDir = '';

  afterEach(async () => {
    await resetDb();
    resetObservationRuntime();
    resetObservationStore();
    closeAllDatabases();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('reports and rebuilds the SQLite FTS view through the common contract', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-fts-view-'));
    const view = createFtsDerivedView(dataDir);
    expect((await view.status()).state).toBe('ready');
    expect(await view.rebuild()).toBe(true);
    await view.refresh({ rebuild: true });
    await view.compact();
    await view.close();
  });

  it('refreshes and closes the Orama view without changing canonical storage', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-orama-view-'));
    await initObservations(dataDir);
    const view = createOramaDerivedView();
    await view.refresh([{
      id: 1,
      entityName: 'auth',
      type: 'decision',
      title: 'Use signed sessions',
      narrative: 'Keep sessions reviewable.',
      facts: [],
      filesModified: [],
      concepts: [],
      tokens: 5,
      createdAt: new Date().toISOString(),
      projectId: 'org/repo',
      status: 'active',
    } as any]);
    expect((await view.status()).state).toBe('ready');
    expect((await view.status()).rowCount).toBe(1);
    await view.close();
    expect((await view.status()).state).toBe('missing');
  });
});
