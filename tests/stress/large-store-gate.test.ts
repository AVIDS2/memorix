/**
 * Reproducible large-store gate for the embedding-cache / control-plane PR.
 *
 * Always runs 1,000 records. Set MEMORIX_LARGE_STORE_40K=1 to also run 40k
 * when the machine can spare a few minutes.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryClient } from '../../src/sdk.js';
import { getEmbeddingRuntimeHealth, resetProvider } from '../../src/embedding/provider.js';
import {
  ensureDiskCacheLoaded,
  resetApiEmbeddingCacheForTests,
} from '../../src/embedding/api-provider.js';
import { hookObservationRuntimeOptions } from '../../src/hooks/lifecycle.js';
import {
  initObservations,
  resetObservationRuntime,
  storeObservation,
} from '../../src/memory/observations.js';
import { initObservationStore, resetObservationStore } from '../../src/store/obs-store.js';
import { resetDb } from '../../src/store/orama-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { resetConfigCache } from '../../src/config.js';

const RUN_40K = process.env.MEMORIX_LARGE_STORE_40K === '1';

function uniqueLookupToken(index: number): string {
  let value = index;
  let suffix = '';
  do {
    suffix = String.fromCharCode(97 + (value % 26)) + suffix;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return `lookupkey${suffix}`;
}

function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

describe('large-store gate', () => {
  let sandbox = '';
  let previousDataDir: string | undefined;
  let previousEmbedding: string | undefined;

  beforeEach(() => {
    sandbox = mkdtempSync(path.join(tmpdir(), 'memorix-large-store-'));
    previousDataDir = process.env.MEMORIX_DATA_DIR;
    previousEmbedding = process.env.MEMORIX_EMBEDDING;
    process.env.MEMORIX_DATA_DIR = path.join(sandbox, 'data');
    process.env.MEMORIX_EMBEDDING = 'off';
    resetConfigCache();
    resetProvider();
    resetApiEmbeddingCacheForTests();
    resetObservationRuntime();
  });

  afterEach(async () => {
    resetObservationStore();
    resetObservationRuntime();
    await resetDb();
    closeAllDatabases();
    resetProvider();
    resetApiEmbeddingCacheForTests();
    if (previousDataDir === undefined) delete process.env.MEMORIX_DATA_DIR;
    else process.env.MEMORIX_DATA_DIR = previousDataDir;
    if (previousEmbedding === undefined) delete process.env.MEMORIX_EMBEDDING;
    else process.env.MEMORIX_EMBEDDING = previousEmbedding;
    resetConfigCache();
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
    sandbox = '';
  });

  async function runGate(records: number): Promise<void> {
    const projectRoot = path.join(sandbox, 'project');
    execSync('git init --quiet', { cwd: sandbox, encoding: 'utf8' });
    execSync(`git init --quiet "${projectRoot}"`, { encoding: 'utf8' });

    const client = await createMemoryClient({ projectRoot, silent: true });
    const warmup = 20;
    const steady: number[] = [];
    let peakRss = process.memoryUsage().rss;

    for (let index = 0; index < records; index += 1) {
      const lookupToken = uniqueLookupToken(index);
      const started = performance.now();
      await client.store({
        entityName: `module-${index % 64}`,
        type: index % 5 === 0 ? 'decision' : 'discovery',
        title: `Large-store gate record ${index}`,
        narrative: `Module ${index % 64} recorded gate evidence for scenario ${index} with ${lookupToken}.`,
        facts: [`scenario=${index}`, `module=${index % 64}`, lookupToken],
        concepts: ['gate', 'large-store', `module-${index % 64}`, lookupToken],
      });
      const elapsed = performance.now() - started;
      if (index >= warmup) steady.push(elapsed);
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }

    const healthStarted = performance.now();
    const health = getEmbeddingRuntimeHealth();
    const healthMs = performance.now() - healthStarted;
    expect(health.status).toBe('disabled');
    expect(healthMs).toBeLessThan(20);

    const searchStarted = performance.now();
    const hits = await client.search({
      query: uniqueLookupToken(0),
      quality: 'fast',
      limit: 10,
    });
    const searchMs = performance.now() - searchStarted;
    expect(hits.length).toBeGreaterThan(0);
    // 1k stays on the fast lexical budget. 40k is a cold in-process search
    // after seed, not the HTTP /health path — allow the larger corpus.
    expect(searchMs).toBeLessThan(records <= 1_000 ? 250 : 1_500);

    const p50 = percentile(steady, 0.5);
    const p95 = percentile(steady, 0.95);
    expect(p50).toBeLessThan(25);
    expect(p95).toBeLessThan(80);
    // 40k keeps the full lexical index in-process. That is larger than the
    // 1k budget but must stay well below an unbounded 4096d cache.
    expect(peakRss).toBeLessThan((records <= 1_000 ? 512 : 2048) * 1024 * 1024);

    await client.close();
    closeAllDatabases();
    resetObservationStore();
    resetObservationRuntime();
    await resetDb();

    const hookInitStarted = performance.now();
    await initObservationStore(process.env.MEMORIX_DATA_DIR!);
    await initObservations(process.env.MEMORIX_DATA_DIR!, hookObservationRuntimeOptions(projectRoot));
    const hookInitMs = performance.now() - hookInitStarted;
    const hookWriteStarted = performance.now();
    const { observation } = await storeObservation({
      entityName: 'hook-gate',
      type: 'what-changed',
      title: 'Hook write after large store',
      narrative: 'PostToolUse must persist without hydrating the corpus.',
      projectId: client.projectId,
      sourceDetail: 'hook',
    });
    const hookWriteMs = performance.now() - hookWriteStarted;
    expect(observation.id).toBeGreaterThan(records);
    expect(hookWriteMs).toBeLessThan(200);
    expect(hookInitMs + hookWriteMs).toBeLessThan(records <= 1_000 ? 200 : 1_000);

    const jsonl = path.join(process.env.MEMORIX_DATA_DIR!, '.embedding-api-cache.jsonl');
    writeFileSync(
      jsonl,
      `${JSON.stringify({ h: 'gatehash00000001', v: [0.1, 0.2, 0.3] })}\n${JSON.stringify({ h: 'gatehash00000002', v: [0.4, 0.5, 0.6] })}\n`,
    );
    resetApiEmbeddingCacheForTests();
    const loaded = await ensureDiskCacheLoaded();
    expect(loaded).toBe(2);
    const persisted = readFileSync(jsonl, 'utf8').trim().split('\n');
    expect(persisted).toHaveLength(2);
  }

  it('stays responsive at 1k records', { timeout: 60_000 }, async () => {
    await runGate(1_000);
  });

  it.skipIf(!RUN_40K)('stays responsive at 40k records', { timeout: 600_000 }, async () => {
    await runGate(40_000);
  });
});
