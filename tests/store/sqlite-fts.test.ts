import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeAllDatabases, getDatabase } from '../../src/store/sqlite-db.js';
import { SqliteBackend } from '../../src/store/sqlite-store.js';
import { initializeObservationLexicalIndex, isObservationLexicalIndexEnabled } from '../../src/store/sqlite-fts.js';
import type { Observation } from '../../src/types.js';

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: 1,
    entityName: 'api-client',
    type: 'discovery',
    title: 'OAuth2 client refreshes access tokens',
    narrative: 'The OAuth2 client refreshes an expired access token before retrying a request.',
    facts: ['provider=identity', 'retry=bounded'],
    filesModified: ['src/auth/oauth2-client.ts'],
    concepts: ['oauth2', 'authentication'],
    tokens: 20,
    createdAt: '2026-09-08T00:00:00.000Z',
    projectId: 'project-alpha',
    status: 'active',
    ...overrides,
  };
}

describe('SQLite persistent lexical index', () => {
  let dataDir: string;
  let store: SqliteBackend;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-fts-'));
    store = new SqliteBackend();
    await store.init(dataDir);
  });

  afterEach(() => {
    store.close();
    closeAllDatabases();
  });

  it('keeps lexical results current across insert, update, and delete', async () => {
    await store.insert(observation());
    expect(store.hasLexicalIndex()).toBe(true);

    await expect(store.searchLexical({ query: 'oauth2 refresh', projectId: 'project-alpha', limit: 10 }))
      .resolves.toEqual([expect.objectContaining({ observation: expect.objectContaining({ id: 1 }) })]);

    const updated = observation({
      title: 'SAML session expires on idle timeout',
      narrative: 'SAML sessions expire after a bounded idle period.',
      facts: ['provider=sso', 'timeout=idle'],
      filesModified: ['src/auth/saml-session.ts'],
      concepts: ['saml', 'session'],
    });
    await store.update(updated);
    await expect(store.searchLexical({ query: 'oauth2 refresh', projectId: 'project-alpha', limit: 10 }))
      .resolves.toEqual([]);
    await expect(store.searchLexical({ query: 'SAML idle', projectId: 'project-alpha', limit: 10 }))
      .resolves.toEqual([expect.objectContaining({ observation: expect.objectContaining({ title: updated.title }) })]);

    await store.remove(1);
    await expect(store.searchLexical({ query: 'SAML idle', projectId: 'project-alpha', limit: 10 }))
      .resolves.toEqual([]);
  });

  it('returns bounded candidates without materializing the full corpus', async () => {
    await store.insert(observation());
    const loadAll = vi.spyOn(store, 'loadAll');

    const results = await store.searchLexical({
      query: 'oauth2',
      projectId: 'project-alpha',
      limit: 1,
    });

    expect(results).toHaveLength(1);
    expect(loadAll).not.toHaveBeenCalled();
  });

  it('rebuilds a stale derived index from durable observations', async () => {
    await store.insert(observation());
    const db = (store as any).db;
    db.exec("DELETE FROM observations_fts");
    await expect(store.searchLexical({ query: 'oauth2', projectId: 'project-alpha', limit: 10 }))
      .resolves.toEqual([]);

    await expect(store.rebuildLexicalIndex()).resolves.toBe(true);
    await expect(store.searchLexical({ query: 'oauth2', projectId: 'project-alpha', limit: 10 }))
      .resolves.toEqual([expect.objectContaining({ observation: expect.objectContaining({ id: 1 }) })]);
  });

  it('handles punctuation-heavy identifiers as data, not FTS operators', async () => {
    await store.insert(observation({ title: 'Fix requests.header-map v2', narrative: 'Keep requests.header-map compatible with read-only mappings.' }));

    const results = await store.searchLexical({
      query: 'requests.header-map',
      projectId: 'project-alpha',
      limit: 10,
    });

    expect(results[0]?.observation.title).toContain('requests.header-map');
  });
});

describe('initializeObservationLexicalIndex under contention', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-fts-init-'));
  });

  afterEach(() => {
    closeAllDatabases();
  });

  it('retries a transient cross-process BUSY instead of permanently disabling FTS5', () => {
    const realDb = getDatabase(dataDir); // real schema, including a working FTS5 index
    let execCalls = 0;
    const flaky = {
      exec: (sql: string) => {
        execCalls++;
        if (execCalls === 1) throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
        return realDb.exec(sql);
      },
      prepare: (sql: string) => realDb.prepare(sql),
    };

    expect(initializeObservationLexicalIndex(flaky)).toBe(true);
    expect(execCalls).toBeGreaterThan(1);
    expect(isObservationLexicalIndexEnabled(flaky)).toBe(true);
  });

  it('does not retry a non-transient failure, and caches it as unavailable', () => {
    const realDb = getDatabase(dataDir);
    let execCalls = 0;
    const broken = {
      exec: (sql: string) => {
        execCalls++;
        throw Object.assign(new Error('database disk image is malformed'), { code: 'SQLITE_CORRUPT' });
      },
      prepare: (sql: string) => realDb.prepare(sql),
    };

    expect(initializeObservationLexicalIndex(broken)).toBe(false);
    expect(execCalls).toBe(1);
    expect(isObservationLexicalIndexEnabled(broken)).toBe(false);
  });

  it('gives up after exhausting retries on sustained BUSY, without throwing', () => {
    const realDb = getDatabase(dataDir);
    let execCalls = 0;
    const alwaysBusy = {
      exec: (sql: string) => {
        execCalls++;
        throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
      },
      prepare: (sql: string) => realDb.prepare(sql),
    };

    expect(() => initializeObservationLexicalIndex(alwaysBusy)).not.toThrow();
    expect(initializeObservationLexicalIndex(alwaysBusy)).toBe(false);
    expect(execCalls).toBeGreaterThan(1);
  });
});
