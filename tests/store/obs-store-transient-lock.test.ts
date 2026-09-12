import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { createObservationStore } from '../../src/store/obs-store.js';

let tempDir = '';

afterEach(async () => {
  vi.restoreAllMocks();
  closeAllDatabases();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

/**
 * A transient SQLITE_BUSY while opening the store must not permanently
 * degrade the process to the read-only DegradedBackend.
 *
 * Degrading on lock contention is especially dangerous because DegradedBackend
 * reads return empty rather than throwing, so callers cannot distinguish
 * "storage is broken" from "this project has no observations yet".
 */
describe('createObservationStore under lock contention', () => {
  it('retries a transient lock instead of degrading to read-only', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'memorix-obs-lock-'));

    const sqliteStore = await import('../../src/store/sqlite-store.js');
    const realInit = sqliteStore.SqliteBackend.prototype.init;
    let attempts = 0;

    vi.spyOn(sqliteStore.SqliteBackend.prototype, 'init').mockImplementation(
      async function (this: unknown, dataDir: string) {
        attempts += 1;
        if (attempts === 1) {
          const err = new Error('database is locked') as Error & { code?: string };
          err.code = 'SQLITE_BUSY';
          throw err;
        }
        return realInit.call(this, dataDir);
      },
    );

    const store = await createObservationStore(tempDir);

    expect(attempts).toBe(2);
    expect(store.getBackendName()).toBe('sqlite');

    // The store must be genuinely writable, not merely reporting the right name.
    await expect(
      store.atomic(async (tx) => tx.loadIdCounter()),
    ).resolves.toBeTypeOf('number');
  });

  it('surfaces a persistent lock as an error rather than an empty store', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'memorix-obs-lock-'));

    const sqliteStore = await import('../../src/store/sqlite-store.js');
    vi.spyOn(sqliteStore.SqliteBackend.prototype, 'init').mockImplementation(async () => {
      const err = new Error('database is locked') as Error & { code?: string };
      err.code = 'SQLITE_BUSY';
      throw err;
    });

    // Exhausting retries must throw. Returning an empty read-only store here
    // would let agents conclude the project has no memory at all.
    await expect(createObservationStore(tempDir)).rejects.toThrow(/locked/i);
  });
});
