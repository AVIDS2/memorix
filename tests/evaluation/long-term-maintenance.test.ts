import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createManualLongTermMemory,
  maybeAutoQualifyLongTermMemory,
  maintainLongTermMemories,
  qualifyLongTermMemory,
} from '../../src/memory/long-term.js';
import { LongTermMemoryStore } from '../../src/memory/long-term-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

/**
 * The auto-maintenance exam: long-term memory must maintain itself without
 * manual approval — explicit requests qualify on the spot, stale records
 * archive themselves, and newer records supersede older ones with the same
 * title. Deterministic, offline, no LLM.
 */

const projectId = 'eval/long-term-maintenance';
let dataDir = '';

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function openStore(): Promise<LongTermMemoryStore> {
  const store = new LongTermMemoryStore();
  await store.init(dataDir);
  return store;
}

async function seedCandidate(title: string): Promise<string> {
  const created = await createManualLongTermMemory({
    dataDir,
    projectId,
    kind: 'procedural',
    scope: 'project',
    title,
    content: title + ' content',
    reader: { projectId },
  });
  return created.memory.id;
}

describe('long-term auto maintenance exam', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'memorix-lt-maintain-'));
  });

  afterEach(() => {
    closeAllDatabases();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    dataDir = '';
  });

  it('auto-qualifies candidates from explicit requests, keeps hook candidates pending', async () => {
    const explicitId = await seedCandidate('explicit-request');
    const qualified = await maybeAutoQualifyLongTermMemory({
      dataDir,
      id: explicitId,
      source: 'agent',
      sourceDetail: 'explicit',
    });
    expect(qualified?.state).toBe('qualified');

    const hookId = await seedCandidate('hook-captured');
    const pending = await maybeAutoQualifyLongTermMemory({
      dataDir,
      id: hookId,
      source: 'agent',
      sourceDetail: 'hook',
    });
    expect(pending).toBeNull();
    const store = await openStore();
    expect(store.get(hookId)?.state).toBe('candidate');
  });

  it('auto-archives qualified records with no activity for 30 days', async () => {
    const staleId = await seedCandidate('stale-procedure');
    await qualifyLongTermMemory({ dataDir, id: staleId, reason: 'seed' });
    const store = await openStore();
    const stale = store.get(staleId)!;
    stale.updatedAt = daysAgo(40);
    stale.lastAccessedAt = daysAgo(40);
    store.update(stale);

    const freshId = await seedCandidate('fresh-procedure');
    await qualifyLongTermMemory({ dataDir, id: freshId, reason: 'seed' });

    const result = await maintainLongTermMemories({ dataDir, projectId });
    expect(result.archived).toBe(1);
    expect(store.get(staleId)?.state).toBe('archived');
    expect(store.get(freshId)?.state).toBe('qualified');
  });

  it('supersedes an older qualified record when a newer one shares its title', async () => {
    const oldId = await seedCandidate('shared procedure');
    await qualifyLongTermMemory({ dataDir, id: oldId, reason: 'seed' });
    const store = await openStore();
    const old = store.get(oldId)!;
    old.createdAt = daysAgo(20);
    store.update(old);

    const newId = await seedCandidate('shared procedure');
    await qualifyLongTermMemory({ dataDir, id: newId, reason: 'seed' });

    const result = await maintainLongTermMemories({ dataDir, projectId });
    expect(result.superseded).toBe(1);
    const oldAfter = store.get(oldId)!;
    expect(oldAfter.state).toBe('superseded');
    expect(oldAfter.supersededBy).toBe(newId);
    expect(store.get(newId)?.state).toBe('qualified');
  });

  it('leaves candidates and approved records alone', async () => {
    const candidateId = await seedCandidate('still-candidate');
    const approvedId = await seedCandidate('approved-procedure');
    await qualifyLongTermMemory({ dataDir, id: approvedId, reason: 'seed' });
    const { approveLongTermMemory } = await import('../../src/memory/long-term.js');
    await approveLongTermMemory({ dataDir, id: approvedId, reason: 'seed' });

    const result = await maintainLongTermMemories({ dataDir, projectId });
    expect(result.archived).toBe(0);
    expect(result.superseded).toBe(0);
    const store = await openStore();
    expect(store.get(candidateId)?.state).toBe('candidate');
    expect(store.get(approvedId)?.state).toBe('approved');
  });
});
