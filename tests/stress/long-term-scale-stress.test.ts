import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createManualLongTermMemory,
  maintainLongTermMemories,
  qualifyLongTermMemory,
} from '../../src/memory/long-term.js';
import { LongTermMemoryStore } from '../../src/memory/long-term-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

/**
 * Long-term scale stress exam: maintenance must stay exact and bounded on a
 * 300-record mixed corpus — only stale active records archive, only
 * same-title pairs supersede, candidates are never advanced. Deterministic,
 * offline.
 */

const projectId = 'stress/long-term';
let sandbox = '';

const STALE_QUALIFIED = 60;
const FRESH_QUALIFIED = 80;
const FRESH_CANDIDATES = 60;
const DUP_TITLE_PAIRS = 40; // 80 records → 40 superseded, 40 kept

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('long-term scale stress exam', () => {
  beforeEach(() => {
    sandbox = mkdtempSync(path.join(tmpdir(), 'memorix-stress-longterm-'));
    process.env.MEMORIX_EMBEDDING = 'off';
  });

  afterEach(async () => {
    closeAllDatabases();
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
    sandbox = '';
  });

  it('archives exactly the stale set and supersedes exactly the older halves', async () => {
    const ids: string[] = [];
    const add = async (title: string) => {
      const created = await createManualLongTermMemory({
        dataDir: path.join(sandbox, 'data'),
        projectId,
        kind: 'procedural',
        scope: 'project',
        title,
        content: `${title} content`,
        reader: { projectId },
      });
      ids.push(created.memory.id);
      return created.memory.id;
    };

    const staleIds: string[] = [];
    for (let i = 0; i < STALE_QUALIFIED; i++) {
      const id = await add(`stale procedure ${i}`);
      await qualifyLongTermMemory({ dataDir: path.join(sandbox, 'data'), id, reason: 'stress' });
      staleIds.push(id);
    }
    for (let i = 0; i < FRESH_QUALIFIED; i++) {
      const id = await add(`fresh procedure ${i}`);
      await qualifyLongTermMemory({ dataDir: path.join(sandbox, 'data'), id, reason: 'stress' });
    }
    for (let i = 0; i < FRESH_CANDIDATES; i++) {
      await add(`pending candidate ${i}`);
    }
    const olderHalves: string[] = [];
    for (let i = 0; i < DUP_TITLE_PAIRS; i++) {
      const older = await add(`shared title ${i}`);
      await qualifyLongTermMemory({ dataDir: path.join(sandbox, 'data'), id: older, reason: 'stress' });
      olderHalves.push(older);
      const newer = await add(`shared title ${i}`);
      await qualifyLongTermMemory({ dataDir: path.join(sandbox, 'data'), id: newer, reason: 'stress' });
    }

    // Backdate the stale set so decay applies to it alone.
    const store = new LongTermMemoryStore();
    await store.init(path.join(sandbox, 'data'));
    for (const id of staleIds) {
      const memory = store.get(id)!;
      memory.updatedAt = daysAgo(40);
      memory.lastAccessedAt = daysAgo(40);
      store.update(memory);
    }

    const startedAt = Date.now();
    const result = await maintainLongTermMemories({
      dataDir: path.join(sandbox, 'data'),
      projectId,
    });
    const elapsed = Date.now() - startedAt;

    expect(result.archived).toBe(STALE_QUALIFIED);
    expect(result.superseded).toBe(DUP_TITLE_PAIRS);
    expect(elapsed, 'maintenance on 300 records must stay bounded').toBeLessThan(15_000);

    // Re-open and verify final states.
    const after = new LongTermMemoryStore();
    await after.init(path.join(sandbox, 'data'));
    for (const id of staleIds) {
      expect(after.get(id)?.state).toBe('archived');
    }
    for (const id of olderHalves) {
      expect(after.get(id)?.state).toBe('superseded');
    }
    const active = after.list({ originProjectId: projectId })
      .filter((memory) => memory.state === 'qualified' || memory.state === 'approved');
    expect(active.length).toBe(FRESH_QUALIFIED + DUP_TITLE_PAIRS);
    const candidates = after.list({ originProjectId: projectId })
      .filter((memory) => memory.state === 'candidate');
    expect(candidates.length).toBe(FRESH_CANDIDATES);
    // eslint-disable-next-line no-console
    console.log(`[stress] long-term maintenance: ${result.archived} archived, ${result.superseded} superseded in ${elapsed}ms`);
  }, 120_000);
});
