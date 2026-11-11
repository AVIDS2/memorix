import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyDeduplicationPlan, planMemoryDeduplication } from '../../src/memory/deduplication.js';
import { SqliteBackend } from '../../src/store/sqlite-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import type { CompactDecision } from '../../src/llm/memory-manager.js';
import type { Observation } from '../../src/types.js';

function observation(id: number, title: string, overrides: Partial<Observation> = {}): Observation {
  return {
    id,
    entityName: 'auth',
    type: 'decision',
    title,
    narrative: title,
    facts: [],
    filesModified: [],
    concepts: [],
    tokens: 10,
    createdAt: new Date(2026, 0, id).toISOString(),
    projectId: 'test/project',
    status: 'active',
    ...overrides,
  };
}

describe('deduplication plan', () => {
  let dataDir: string;
  let store: SqliteBackend;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-dedup-plan-'));
    store = new SqliteBackend();
    await store.init(dataDir);
  });

  afterEach(async () => {
    store.close();
    closeAllDatabases();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it.each([
    ['UPDATE', 1, 2],
    ['NONE', 2, 1],
    ['DELETE', 1, 2],
  ] as const)('maps %s decisions to the record that should resolve', async (action, resolveId, keepId) => {
    const decide = async (): Promise<CompactDecision> => ({
      action,
      targetId: action === 'NONE' ? undefined : 1,
      reason: 'same durable fact',
      usedLLM: true,
    });
    const plan = await planMemoryDeduplication([
      observation(1, 'Older'),
      observation(2, 'Newer'),
    ], { decide });

    expect(plan.actions).toMatchObject([{ resolveId, keepId, decision: action }]);
    expect(plan.resolveIds).toEqual([resolveId]);
  });

  it('continues when one LLM comparison fails', async () => {
    const plan = await planMemoryDeduplication(
      [observation(1, 'Older'), observation(2, 'Newer')],
      { decide: async () => { throw new Error('provider timeout'); } },
    );
    expect(plan).toMatchObject({ comparisons: 1, failedComparisons: 1, actions: [] });
  });

  it('keeps at least one active survivor when mixed decisions form a cycle', async () => {
    const decisions: CompactDecision[] = [
      { action: 'NONE', reason: 'keep first', usedLLM: true },
      { action: 'DELETE', targetId: 1, reason: 'drop first', usedLLM: true },
      { action: 'NONE', reason: 'keep second', usedLLM: true },
    ];
    const plan = await planMemoryDeduplication([
      observation(1, 'First'),
      observation(2, 'Second'),
      observation(3, 'Third'),
    ], { decide: async () => decisions.shift() ?? null });

    expect(plan.resolveIds).not.toContain(3);
    expect(new Set(plan.resolveIds).size).toBeLessThan(3);
  });

  it('applies only active manageable records from the selected project', async () => {
    await store.insert(observation(1, 'Resolve me'));
    await store.insert(observation(2, 'Other project', { projectId: 'other/project' }));
    await store.insert(observation(3, 'Private', { visibility: 'personal', createdByAgentId: 'owner' }));

    const result = await applyDeduplicationPlan(store, 'test/project', [1, 2, 3], { projectId: 'test/project' });

    expect(result).toEqual({ resolved: [], skipped: [2, 3] });
    expect(await store.getById(1)).toMatchObject({ status: 'active' });
    expect(await store.getById(2)).toMatchObject({ status: 'active' });
    expect(await store.getById(3)).toMatchObject({ status: 'active' });
  });
});
