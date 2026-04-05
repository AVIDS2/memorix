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

import { SqliteBackend } from '../../src/store/sqlite-store.js';
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
import type { Observation } from '../../src/types.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-freshness-'));
  await resetDb();
});

afterEach(async () => {
  resetObservationStore();
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

    // ── Instance A: open same DB and write directly (simulates another process)
    const instanceA = new SqliteBackend();
    await instanceA.init(tmpDir);
    await instanceA.insert(makeObs(1, 'Written by Process A'));
    await instanceA.saveIdCounter(2);
    instanceA.close();

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

    // ── Instance A: write 2 observations to shared SQLite
    const instanceA = new SqliteBackend();
    await instanceA.init(tmpDir);
    await instanceA.insert(makeObs(1, 'Authentication module setup'));
    await instanceA.insert(makeObs(2, 'Database schema migration'));
    await instanceA.saveIdCounter(3);
    instanceA.close();

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

    const instanceA = new SqliteBackend();
    await instanceA.init(tmpDir);
    await instanceA.insert(makeObs(1, 'Timeline anchor from Process A'));
    await instanceA.saveIdCounter(2);
    instanceA.close();

    const timeline = await getTimeline(1, 'test/freshness');
    expect(timeline.anchor).not.toBeNull();
    expect(timeline.anchor?.title).toBe('Timeline anchor from Process A');

    // The timeline path should have refreshed the shared in-memory cache too.
    expect(getObservation(1)?.title).toBe('Timeline anchor from Process A');
  });

  it('multiple rounds of A-write → B-refresh work correctly', async () => {
    await initObservations(tmpDir);

    // Round 1: A writes obs #1
    const a1 = new SqliteBackend();
    await a1.init(tmpDir);
    await a1.insert(makeObs(1, 'Round 1 observation'));
    await a1.saveIdCounter(2);
    a1.close();

    await ensureFreshObservations();
    expect(getAllObservations()).toHaveLength(1);

    // Round 2: A writes obs #2
    const a2 = new SqliteBackend();
    await a2.init(tmpDir);
    await a2.insert(makeObs(2, 'Round 2 observation'));
    await a2.saveIdCounter(3);
    a2.close();

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

    // A writes directly to SQLite
    const instanceA = new SqliteBackend();
    await instanceA.init(tmpDir);
    // A sees B's write (via migration or shared DB)
    const existing = await instanceA.loadAll();
    const newObs = makeObs(existing.length + 1, 'Written by A');
    await instanceA.insert(newObs);
    await instanceA.saveIdCounter(existing.length + 2);
    instanceA.close();

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
