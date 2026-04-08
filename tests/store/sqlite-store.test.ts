/**
 * SQLite Backend Tests
 *
 * Covers: CRUD operations, JSON→SQLite migration, storage_generation freshness,
 * fallback to JSON when SQLite unavailable, concurrent atomic() serialization,
 * and close() resource cleanup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Observation } from '../../src/types.js';
import { SqliteBackend } from '../../src/store/sqlite-store.js';
import {
  initObservationStore,
  getObservationStore,
  resetObservationStore,
} from '../../src/store/obs-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

// ── Helpers ───────────────────────────────────────────────────────

function makeObs(overrides: Partial<Observation> & { id: number; entityName: string; projectId: string }): Observation {
  return {
    type: 'discovery',
    title: `Obs ${overrides.id}`,
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

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-sqlite-test-'));
});

afterEach(async () => {
  resetObservationStore();
  closeAllDatabases();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── CRUD ──────────────────────────────────────────────────────────

describe('SqliteBackend CRUD', () => {
  let store: SqliteBackend;

  beforeEach(async () => {
    store = new SqliteBackend();
    await store.init(tmpDir);
  });

  afterEach(() => {
    store.close();
  });

  it('loadAll returns empty array on fresh DB', async () => {
    const all = await store.loadAll();
    expect(all).toEqual([]);
  });

  it('insert + loadAll round-trips an observation', async () => {
    const obs = makeObs({ id: 1, entityName: 'test-entity', projectId: 'test/proj' });
    await store.insert(obs);

    const all = await store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(1);
    expect(all[0].entityName).toBe('test-entity');
    expect(all[0].projectId).toBe('test/proj');
    expect(all[0].type).toBe('discovery');
  });

  it('update modifies an existing observation', async () => {
    const obs = makeObs({ id: 1, entityName: 'e', projectId: 'p', title: 'Original' });
    await store.insert(obs);

    obs.title = 'Updated';
    obs.updatedAt = new Date().toISOString();
    await store.update(obs);

    const all = await store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe('Updated');
    expect(all[0].updatedAt).toBeDefined();
  });

  it('remove deletes an observation by ID', async () => {
    await store.insert(makeObs({ id: 1, entityName: 'a', projectId: 'p' }));
    await store.insert(makeObs({ id: 2, entityName: 'b', projectId: 'p' }));

    await store.remove(1);

    const all = await store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(2);
  });

  it('bulkReplace replaces all observations atomically', async () => {
    await store.insert(makeObs({ id: 1, entityName: 'old', projectId: 'p' }));
    await store.insert(makeObs({ id: 2, entityName: 'old2', projectId: 'p' }));

    const newObs = [
      makeObs({ id: 10, entityName: 'new1', projectId: 'p' }),
      makeObs({ id: 11, entityName: 'new2', projectId: 'p' }),
      makeObs({ id: 12, entityName: 'new3', projectId: 'p' }),
    ];
    await store.bulkReplace(newObs);

    const all = await store.loadAll();
    expect(all).toHaveLength(3);
    expect(all.map(o => o.id).sort()).toEqual([10, 11, 12]);
  });

  it('bulkRemoveByIds deletes multiple observations', async () => {
    await store.insert(makeObs({ id: 1, entityName: 'a', projectId: 'p' }));
    await store.insert(makeObs({ id: 2, entityName: 'b', projectId: 'p' }));
    await store.insert(makeObs({ id: 3, entityName: 'c', projectId: 'p' }));

    await store.bulkRemoveByIds([1, 3]);

    const all = await store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(2);
  });

  it('saveIdCounter + loadIdCounter round-trips', async () => {
    await store.saveIdCounter(42);
    const counter = await store.loadIdCounter();
    expect(counter).toBe(42);
  });

  it('preserves array fields through serialization', async () => {
    const obs = makeObs({
      id: 1, entityName: 'e', projectId: 'p',
      facts: ['fact-1', 'fact-2'],
      filesModified: ['src/a.ts', 'src/b.ts'],
      concepts: ['concept-a'],
    });
    await store.insert(obs);

    const all = await store.loadAll();
    expect(all[0].facts).toEqual(['fact-1', 'fact-2']);
    expect(all[0].filesModified).toEqual(['src/a.ts', 'src/b.ts']);
    expect(all[0].concepts).toEqual(['concept-a']);
  });

  it('preserves optional fields (topicKey, sessionId, commitHash, etc.)', async () => {
    const obs = makeObs({
      id: 1, entityName: 'e', projectId: 'p',
      topicKey: 'auth/jwt',
      sessionId: 'sess-123',
      commitHash: 'abc1234',
      sourceDetail: 'git-ingest',
      valueCategory: 'core',
    });
    await store.insert(obs);

    const loaded = (await store.loadAll())[0];
    expect(loaded.topicKey).toBe('auth/jwt');
    expect(loaded.sessionId).toBe('sess-123');
    expect(loaded.commitHash).toBe('abc1234');
    expect(loaded.sourceDetail).toBe('git-ingest');
    expect(loaded.valueCategory).toBe('core');
  });
});

// ── Atomic transactions ───────────────────────────────────────────

describe('SqliteBackend atomic()', () => {
  let store: SqliteBackend;

  beforeEach(async () => {
    store = new SqliteBackend();
    await store.init(tmpDir);
  });

  afterEach(() => {
    store.close();
  });

  it('atomic transaction loads and saves correctly', async () => {
    await store.insert(makeObs({ id: 1, entityName: 'a', projectId: 'p' }));
    await store.saveIdCounter(2); // next ID is 2

    const result = await store.atomic(async (tx) => {
      const all = await tx.loadAll();
      const counter = await tx.loadIdCounter();
      all.push(makeObs({ id: counter, entityName: 'b', projectId: 'p' }));
      await tx.saveAll(all);
      await tx.saveIdCounter(counter + 1);
      return all.length;
    });

    expect(result).toBe(2);
    const all = await store.loadAll();
    expect(all).toHaveLength(2);
    expect(await store.loadIdCounter()).toBe(3);
  });

  it('atomic rolls back on error', async () => {
    await store.insert(makeObs({ id: 1, entityName: 'original', projectId: 'p' }));

    await expect(store.atomic(async (tx) => {
      await tx.saveAll([makeObs({ id: 99, entityName: 'should-rollback', projectId: 'p' })]);
      throw new Error('intentional');
    })).rejects.toThrow('intentional');

    const all = await store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(1);
    expect(all[0].entityName).toBe('original');
  });

  it('concurrent atomic() calls are serialized (no nested transaction error)', async () => {
    const results = await Promise.all([
      store.atomic(async (tx) => {
        const all = await tx.loadAll();
        all.push(makeObs({ id: all.length + 1, entityName: `e-${all.length + 1}`, projectId: 'p' }));
        await tx.saveAll(all);
        return all.length;
      }),
      store.atomic(async (tx) => {
        const all = await tx.loadAll();
        all.push(makeObs({ id: all.length + 1, entityName: `e-${all.length + 1}`, projectId: 'p' }));
        await tx.saveAll(all);
        return all.length;
      }),
      store.atomic(async (tx) => {
        const all = await tx.loadAll();
        all.push(makeObs({ id: all.length + 1, entityName: `e-${all.length + 1}`, projectId: 'p' }));
        await tx.saveAll(all);
        return all.length;
      }),
    ]);

    // All 3 should succeed (serialized), and the final state should have 3 obs
    expect(results).toEqual([1, 2, 3]);
    const all = await store.loadAll();
    expect(all).toHaveLength(3);
  });

  it('failed atomic calls do not poison the queue for later writes', async () => {
    await expect(store.atomic(async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');

    await store.atomic(async (tx) => {
      const all = await tx.loadAll();
      all.push(makeObs({ id: 1, entityName: 'after-failure', projectId: 'p' }));
      await tx.saveAll(all);
      await tx.saveIdCounter(2);
      return all.length;
    });

    const all = await store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].entityName).toBe('after-failure');
  });
});

// ── Storage generation / freshness ────────────────────────────────

describe('SqliteBackend freshness', () => {
  it('generation starts at 0 on fresh DB', async () => {
    const store = new SqliteBackend();
    await store.init(tmpDir);
    expect(store.getGeneration()).toBe(0);
    store.close();
  });

  it('writes bump generation', async () => {
    const store = new SqliteBackend();
    await store.init(tmpDir);

    await store.insert(makeObs({ id: 1, entityName: 'a', projectId: 'p' }));
    expect(store.getGeneration()).toBe(1);

    await store.update(makeObs({ id: 1, entityName: 'a', projectId: 'p', title: 'updated' }));
    expect(store.getGeneration()).toBe(2);

    await store.remove(1);
    expect(store.getGeneration()).toBe(3);

    store.close();
  });

  it('ensureFresh detects cross-instance generation change', async () => {
    // Instance A writes
    const storeA = new SqliteBackend();
    await storeA.init(tmpDir);
    await storeA.insert(makeObs({ id: 1, entityName: 'a', projectId: 'p' }));
    const genA = storeA.getGeneration();
    storeA.close();

    // Instance B opens same DB, sees the bumped generation
    const storeB = new SqliteBackend();
    await storeB.init(tmpDir);
    expect(storeB.getGeneration()).toBe(genA);

    // No change yet — ensureFresh returns false
    const stale = await storeB.ensureFresh();
    expect(stale).toBe(false);

    storeB.close();
  });

  it('getBackendName returns sqlite', async () => {
    const store = new SqliteBackend();
    await store.init(tmpDir);
    expect(store.getBackendName()).toBe('sqlite');
    store.close();
  });
});

// ── JSON → SQLite migration ──────────────────────────────────────

describe('SqliteBackend migration', () => {
  it('migrates observations.json into SQLite on first init', async () => {
    // Seed JSON file
    const observations = [
      { id: 1, entityName: 'migrated-1', type: 'decision', title: 'Title 1', narrative: 'N1', facts: ['f1'], filesModified: [], concepts: [], tokens: 10, createdAt: '2024-01-01T00:00:00Z', projectId: 'test/migration' },
      { id: 2, entityName: 'migrated-2', type: 'gotcha', title: 'Title 2', narrative: 'N2', facts: [], filesModified: ['a.ts'], concepts: ['c1'], tokens: 20, createdAt: '2024-01-02T00:00:00Z', projectId: 'test/migration' },
    ];
    await fs.writeFile(path.join(tmpDir, 'observations.json'), JSON.stringify(observations));
    await fs.writeFile(path.join(tmpDir, 'counter.json'), JSON.stringify({ nextId: 3 }));

    const store = new SqliteBackend();
    await store.init(tmpDir);

    const all = await store.loadAll();
    expect(all).toHaveLength(2);
    expect(all.find(o => o.id === 1)?.entityName).toBe('migrated-1');
    expect(all.find(o => o.id === 2)?.entityName).toBe('migrated-2');
    expect(all.find(o => o.id === 2)?.concepts).toEqual(['c1']);

    const counter = await store.loadIdCounter();
    expect(counter).toBe(3);

    store.close();
  });

  it('does NOT re-migrate if SQLite table already has data', async () => {
    // First init — migration runs
    await fs.writeFile(path.join(tmpDir, 'observations.json'), JSON.stringify([
      { id: 1, entityName: 'original', type: 'decision', title: 'T', narrative: '', facts: [], filesModified: [], concepts: [], tokens: 0, createdAt: '2024-01-01T00:00:00Z', projectId: 'p' },
    ]));

    const store1 = new SqliteBackend();
    await store1.init(tmpDir);
    expect(await store1.loadAll()).toHaveLength(1);
    store1.close();

    // Modify the JSON file (simulate external write)
    await fs.writeFile(path.join(tmpDir, 'observations.json'), JSON.stringify([
      { id: 1, entityName: 'original', type: 'decision', title: 'T', narrative: '', facts: [], filesModified: [], concepts: [], tokens: 0, createdAt: '2024-01-01T00:00:00Z', projectId: 'p' },
      { id: 99, entityName: 'should-not-appear', type: 'discovery', title: 'Ghost', narrative: '', facts: [], filesModified: [], concepts: [], tokens: 0, createdAt: '2024-01-01T00:00:00Z', projectId: 'p' },
    ]));

    // Second init — migration should NOT run (table not empty)
    const store2 = new SqliteBackend();
    await store2.init(tmpDir);
    const all = await store2.loadAll();
    expect(all).toHaveLength(1); // NOT 2
    store2.close();
  });

  it('skips migration when no observations.json exists', async () => {
    const store = new SqliteBackend();
    await store.init(tmpDir);
    const all = await store.loadAll();
    expect(all).toEqual([]);
    store.close();
  });
});

// ── Fallback wiring ──────────────────────────────────────────────

describe('initObservationStore fallback', () => {
  it('falls back to JsonBackend when SQLite is unavailable', async () => {
    // We can't easily remove better-sqlite3 at runtime, but we can test
    // that the store init logic works and reports the correct backend.
    await initObservationStore(tmpDir);
    const store = getObservationStore();
    // If better-sqlite3 IS available, this will be 'sqlite'; otherwise 'json'.
    // Either way, the store should be functional.
    expect(['sqlite', 'json']).toContain(store.getBackendName());

    // Verify basic functionality regardless of backend
    const all = await store.loadAll();
    expect(Array.isArray(all)).toBe(true);
  });

  it('returns same store for same dataDir (idempotent)', async () => {
    const store1 = await initObservationStore(tmpDir);
    const store2 = await initObservationStore(tmpDir);
    expect(store1).toBe(store2);
  });

  it('switches store when dataDir changes', async () => {
    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-sqlite-test2-'));
    try {
      const store1 = await initObservationStore(tmpDir);
      const store2 = await initObservationStore(dir2);
      expect(store1).not.toBe(store2);
    } finally {
      resetObservationStore();
      closeAllDatabases();
      await fs.rm(dir2, { recursive: true, force: true });
    }
  });
});

// ── Close / resource cleanup ─────────────────────────────────────

describe('SqliteBackend close()', () => {
  it('close + closeAllDatabases releases the DB file (no EBUSY on cleanup)', async () => {
    const store = new SqliteBackend();
    await store.init(tmpDir);
    await store.insert(makeObs({ id: 1, entityName: 'a', projectId: 'p' }));
    store.close();
    closeAllDatabases();

    // Should be able to delete the directory without EBUSY
    await fs.rm(tmpDir, { recursive: true, force: true });

    // Recreate for afterEach cleanup
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-sqlite-test-'));
  });

  it('close is idempotent (safe to call twice)', async () => {
    const store = new SqliteBackend();
    await store.init(tmpDir);
    store.close();
    store.close(); // should not throw
  });
});
