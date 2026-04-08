/**
 * Cross-Process Freshness Integration Test
 *
 * Proves the Phase 1 blocker is resolved:
 *   - Instance A writes to SQLite (bumps storage_generation)
 *   - Instance B's real read path (ensureFreshObservations) detects staleness,
 *     reloads observations[], rebuilds Orama, and sees the new data
 *
 * This test simulates two independent SqliteBackend instances sharing the same
 * DB file, which is exactly what happens when two MCP server processes (or
 * MCP + CLI / MCP + hooks) operate on the same project data directory.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: async () => null,
  isVectorSearchAvailable: async () => false,
  isEmbeddingExplicitlyDisabled: () => true,
  resetProvider: () => {},
}));

import {
  initObservationStore,
  getObservationStore,
  resetObservationStore,
} from '../../src/store/obs-store.js';
import {
  initObservations,
  getAllObservations,
  getObservation,
  getObservationCount,
  ensureFreshObservations,
  storeObservation,
} from '../../src/memory/observations.js';
import { resetDb, searchObservations, getTimeline } from '../../src/store/orama-store.js';
import { closeAllDatabases, loadBetterSqlite3 } from '../../src/store/sqlite-db.js';
import type { Observation } from '../../src/types.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-freshness-'));
  await resetDb();
});

afterEach(async () => {
  resetObservationStore();
  closeAllDatabases();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Helper: directly insert into SQLite via a separate backend instance ──
// Simulates "Process A" writing to the shared DB.
function makeObs(id: number, title: string): Observation {
  return {
    id,
    entityName: `entity-${id}`,
    type: 'discovery',
    title,
    narrative: `Narrative for ${title}`,
    facts: [`fact-${id}`],
    filesModified: [],
    concepts: ['freshness-test'],
    tokens: 10,
    createdAt: new Date().toISOString(),
    projectId: 'test/freshness',
    status: 'active',
    source: 'agent',
  } as Observation;
}

describe('Cross-process freshness', () => {
  it('Instance B detects Instance A write via ensureFreshObservations and reloads', async () => {
    // ── Instance B: initialize observations (simulates MCP server startup)
    await initObservations(tmpDir);
    expect(getAllObservations()).toHaveLength(0);
    expect(getObservationCount()).toBe(0);

    // ── Instance A: open a raw connection (simulates a truly separate process)
    const DB = loadBetterSqlite3();
    const rawA = new DB(path.join(tmpDir, 'memorix.db'));
    rawA.prepare(`INSERT OR REPLACE INTO observations (id, entityName, type, title, narrative, facts, filesModified, concepts, tokens, createdAt, projectId, status, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(1, 'entity-1', 'discovery', 'Written by Process A', 'Narrative', '[]', '[]', '["freshness-test"]', 10, new Date().toISOString(), 'test/freshness', 'active', 'agent');
    rawA.prepare(`UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'storage_generation'`).run();
    rawA.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('next_id', '2')`).run();
    rawA.close();

    // ── Instance B: WITHOUT freshness check, still sees stale empty array
    expect(getAllObservations()).toHaveLength(0);
    expect(getObservation(1)).toBeUndefined();

    // ── Instance B: WITH freshness check, detects generation change and reloads
    const wasStale = await ensureFreshObservations();
    expect(wasStale).toBe(true);

    // Now the real read APIs return fresh data
    expect(getAllObservations()).toHaveLength(1);
    expect(getObservation(1)).toBeDefined();
    expect(getObservation(1)!.title).toBe('Written by Process A');
    expect(getObservationCount()).toBe(1);
  });

  it('ensureFreshObservations returns false when no external writes happened', async () => {
    await initObservations(tmpDir);
    const wasStale = await ensureFreshObservations();
    expect(wasStale).toBe(false);
  });

  it('Orama search index is rebuilt after freshness reload', async () => {
    // ── Instance B: start with empty state
    await initObservations(tmpDir);

    // ── Instance A: write 2 observations via raw connection
    const DB = loadBetterSqlite3();
    const rawA = new DB(path.join(tmpDir, 'memorix.db'));
    const stmt = rawA.prepare(`INSERT OR REPLACE INTO observations (id, entityName, type, title, narrative, facts, filesModified, concepts, tokens, createdAt, projectId, status, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    stmt.run(1, 'entity-1', 'discovery', 'Authentication module setup', 'Narrative', '[]', '[]', '["freshness-test"]', 10, new Date().toISOString(), 'test/freshness', 'active', 'agent');
    stmt.run(2, 'entity-2', 'discovery', 'Database schema migration', 'Narrative', '[]', '[]', '["freshness-test"]', 10, new Date().toISOString(), 'test/freshness', 'active', 'agent');
    rawA.prepare(`UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'storage_generation'`).run();
    rawA.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('next_id', '3')`).run();
    rawA.close();

    // ── Instance B: freshness check triggers reload + Orama reindex
    await ensureFreshObservations();

    // Verify Orama search finds the new observations
    const results = await searchObservations({
      query: 'Authentication module',
      projectId: 'test/freshness',
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.title.includes('Authentication'))).toBe(true);
  });

  it('timeline read path triggers freshness before reading in-memory observations', async () => {
    await initObservations(tmpDir);

    const DB = loadBetterSqlite3();
    const rawA = new DB(path.join(tmpDir, 'memorix.db'));
    rawA.prepare(`INSERT OR REPLACE INTO observations (id, entityName, type, title, narrative, facts, filesModified, concepts, tokens, createdAt, projectId, status, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(1, 'entity-1', 'discovery', 'Timeline anchor from Process A', 'Narrative', '[]', '[]', '["freshness-test"]', 10, new Date().toISOString(), 'test/freshness', 'active', 'agent');
    rawA.prepare(`UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'storage_generation'`).run();
    rawA.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('next_id', '2')`).run();
    rawA.close();

    const timeline = await getTimeline(1, 'test/freshness');
    expect(timeline.anchor).not.toBeNull();
    expect(timeline.anchor?.title).toBe('Timeline anchor from Process A');

    // The timeline path should have refreshed the shared in-memory cache too.
    expect(getObservation(1)?.title).toBe('Timeline anchor from Process A');
  });

  it('multiple rounds of A-write → B-refresh work correctly', async () => {
    await initObservations(tmpDir);

    // Round 1: A writes obs #1
    const DB = loadBetterSqlite3();
    let rawA = new DB(path.join(tmpDir, 'memorix.db'));
    rawA.prepare(`INSERT OR REPLACE INTO observations (id, entityName, type, title, narrative, facts, filesModified, concepts, tokens, createdAt, projectId, status, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(1, 'entity-1', 'discovery', 'Round 1 observation', 'Narrative', '[]', '[]', '["freshness-test"]', 10, new Date().toISOString(), 'test/freshness', 'active', 'agent');
    rawA.prepare(`UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'storage_generation'`).run();
    rawA.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('next_id', '2')`).run();
    rawA.close();

    await ensureFreshObservations();
    expect(getAllObservations()).toHaveLength(1);

    // Round 2: A writes obs #2
    rawA = new DB(path.join(tmpDir, 'memorix.db'));
    rawA.prepare(`INSERT OR REPLACE INTO observations (id, entityName, type, title, narrative, facts, filesModified, concepts, tokens, createdAt, projectId, status, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(2, 'entity-2', 'discovery', 'Round 2 observation', 'Narrative', '[]', '[]', '["freshness-test"]', 10, new Date().toISOString(), 'test/freshness', 'active', 'agent');
    rawA.prepare(`UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'storage_generation'`).run();
    rawA.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('next_id', '3')`).run();
    rawA.close();

    await ensureFreshObservations();
    expect(getAllObservations()).toHaveLength(2);
    expect(getObservation(2)!.title).toBe('Round 2 observation');
  });

  it('B can write via storeObservation, then A writes, then B sees both after refresh', async () => {
    // B writes first
    await initObservations(tmpDir);
    await storeObservation({
      entityName: 'entity-b',
      type: 'decision',
      title: 'Written by B',
      narrative: 'B narrative',
      projectId: 'test/freshness',
    });
    expect(getAllObservations()).toHaveLength(1);

    // A writes directly to SQLite via raw connection
    const DB = loadBetterSqlite3();
    const rawA = new DB(path.join(tmpDir, 'memorix.db'));
    const existingCount = rawA.prepare(`SELECT COUNT(*) AS cnt FROM observations`).get().cnt;
    const newId = existingCount + 1;
    rawA.prepare(`INSERT OR REPLACE INTO observations (id, entityName, type, title, narrative, facts, filesModified, concepts, tokens, createdAt, projectId, status, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(newId, `entity-${newId}`, 'discovery', 'Written by A', 'Narrative', '[]', '[]', '["freshness-test"]', 10, new Date().toISOString(), 'test/freshness', 'active', 'agent');
    rawA.prepare(`UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'storage_generation'`).run();
    rawA.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('next_id', '${newId + 1}')`).run();
    rawA.close();

    // B still sees only its own write
    expect(getAllObservations()).toHaveLength(1);

    // After freshness check, B sees both
    await ensureFreshObservations();
    expect(getAllObservations()).toHaveLength(2);
    const titles = getAllObservations().map(o => o.title);
    expect(titles).toContain('Written by B');
    expect(titles).toContain('Written by A');
  });
});
