import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compactSearch } from '../../src/compact/engine.js';
import { initObservations, storeObservation } from '../../src/memory/observations.js';
import { initObservationStore, resetObservationStore } from '../../src/store/obs-store.js';
import { resetDb } from '../../src/store/orama-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { resetProvider } from '../../src/embedding/provider.js';

/**
 * Corpus stress exam: a 2,000-observation corpus must stay searchable,
 * deterministic, and project-scoped without pathological slowdowns. Runs the
 * REAL search path agents use. Embedding is forced off so the exam stays
 * offline and deterministic.
 */

const projectId = 'stress/corpus';
const originalEmbedding = process.env.MEMORIX_EMBEDDING;
let sandbox = '';

const CORPUS_SIZE = 2_000;
const SEARCH_ROUNDS = 25;
const TOTAL_TIME_BUDGET_MS = 90_000;

async function seedCorpus(): Promise<void> {
  const words = ['auth', 'token', 'release', 'config', 'migration', 'pipeline', 'dashboard', 'graph', 'session', 'retention'];
  for (let i = 0; i < CORPUS_SIZE; i++) {
    const word = words[i % words.length];
    await storeObservation({
      entityName: `entity-${i % 40}`,
      type: 'how-it-works',
      title: `${word} behavior note ${i}`,
      narrative: `Entry ${i}: the ${word} subsystem keeps its invariants documented for later sessions.`,
      projectId,
      source: 'manual',
    });
  }
  // Distinctive needles that no noise term can accidentally match.
  for (const needle of ['zephyrmark-alpha', 'zephyrmark-beta', 'zephyrmark-gamma']) {
    await storeObservation({
      entityName: 'needles',
      type: 'decision',
      title: `Needle ${needle}`,
      narrative: `This is the planted fact ${needle} and nothing else shares its name.`,
      projectId,
      source: 'manual',
    });
  }
}

describe('corpus stress exam', () => {
  beforeEach(() => {
    sandbox = mkdtempSync(path.join(tmpdir(), 'memorix-stress-corpus-'));
    process.env.MEMORIX_EMBEDDING = 'off';
  });

  afterEach(async () => {
    if (originalEmbedding === undefined) delete process.env.MEMORIX_EMBEDDING;
    else process.env.MEMORIX_EMBEDDING = originalEmbedding;
    resetProvider();
    resetObservationStore();
    await resetDb();
    closeAllDatabases();
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
    sandbox = '';
  });

  it('finds every planted needle in a 2,000-observation corpus within budget', async () => {
    await initObservationStore(path.join(sandbox, 'data'));
    await initObservations(path.join(sandbox, 'data'));
    await seedCorpus();

    const startedAt = Date.now();
    const needleHits = new Set<string>();
    let minTokens = Number.POSITIVE_INFINITY;
    let maxTokens = 0;
    for (let round = 0; round < SEARCH_ROUNDS; round++) {
      const needle = `zephyrmark-${['alpha', 'beta', 'gamma'][round % 3]}`;
      const result = await compactSearch({
        query: needle,
        limit: 5,
        projectId,
        reader: { projectId },
      }, 'mcp');
      const titles = result.entries.map((entry) => entry.title);
      expect(titles, `round ${round}`).toContain(`Needle ${needle}`);
      needleHits.add(needle);
      minTokens = Math.min(minTokens, result.totalTokens);
      maxTokens = Math.max(maxTokens, result.totalTokens);
    }
    const elapsed = Date.now() - startedAt;

    expect(needleHits.size).toBe(3);
    expect(minTokens).toBeGreaterThan(0);
    expect(maxTokens).toBeLessThan(1_000);
    expect(elapsed, '25 real searches must stay well under the budget').toBeLessThan(TOTAL_TIME_BUDGET_MS);
    // eslint-disable-next-line no-console
    console.log(`[stress] corpus search: ${SEARCH_ROUNDS} rounds in ${elapsed}ms (tokens ${minTokens}..${maxTokens})`);
  }, 150_000);

  it('returns the same ranked answers for the same query (determinism)', async () => {
    await initObservationStore(path.join(sandbox, 'data'));
    await initObservations(path.join(sandbox, 'data'));
    await seedCorpus();

    const run = async () => (await compactSearch({
      query: 'auth behavior note',
      limit: 10,
      projectId,
      reader: { projectId },
    }, 'mcp')).entries.map((entry) => entry.id);

    const first = await run();
    const second = await run();
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  }, 150_000);

  it('never leaks another project into a project-scoped search', async () => {
    await initObservationStore(path.join(sandbox, 'data'));
    await initObservations(path.join(sandbox, 'data'));
    await seedCorpus();
    await storeObservation({
      entityName: 'other-project',
      type: 'decision',
      title: 'zephyrmark-foreign',
      narrative: 'zephyrmark-foreign belongs to a different project bucket.',
      projectId: 'stress/other-project',
      source: 'manual',
    });

    const result = await compactSearch({
      query: 'zephyrmark',
      limit: 20,
      projectId,
      reader: { projectId },
    }, 'mcp');
    const foreign = result.entries.filter((entry) => entry.title === 'zephyrmark-foreign');
    expect(foreign).toHaveLength(0);
  }, 150_000);
});
