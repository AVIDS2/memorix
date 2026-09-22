import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireDatabase,
  closeAllDatabases,
  evictIdleDatabases,
  getDatabaseStats,
  releaseDatabase,
} from '../../src/store/sqlite-db.js';

const roots: string[] = [];

afterEach(async () => {
  closeAllDatabases();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('SQLite database registry', () => {
  it('keeps leased handles alive while evicting idle handles', async () => {
    const first = await mkdtemp(path.join(os.tmpdir(), 'memorix-db-registry-'));
    const second = await mkdtemp(path.join(os.tmpdir(), 'memorix-db-registry-'));
    const third = await mkdtemp(path.join(os.tmpdir(), 'memorix-db-registry-'));
    roots.push(first, second, third);

    const lease = acquireDatabase(first);
    acquireDatabase(second).release();
    acquireDatabase(third).release();

    const evicted = evictIdleDatabases(1);
    expect(evicted).toBe(2);
    expect(getDatabaseStats()).toMatchObject({ cached: 1, leased: 1 });

    lease.release();
    expect(evictIdleDatabases(0)).toBe(1);
    expect(getDatabaseStats()).toMatchObject({ cached: 0, leased: 0 });
  });

  it('supports idempotent lease release', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'memorix-db-registry-'));
    roots.push(root);

    const lease = acquireDatabase(root);
    lease.release();
    lease.release();

    expect(getDatabaseStats()).toMatchObject({ cached: 1, leased: 0 });
  });
});
