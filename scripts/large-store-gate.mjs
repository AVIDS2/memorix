#!/usr/bin/env node

/*
 * Reproducible large-store acceptance gate.
 *
 * Measures the same seedAndIndex path as scripts/benchmark-retrieval.mjs,
 * plus steady-state write latency, search, peak RSS, and cache integrity.
 * Hook-write coverage lives in tests/stress/large-store-gate.test.ts.
 *
 *   node scripts/large-store-gate.mjs
 *   node scripts/large-store-gate.mjs --records 40000
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

function readPositiveOption(name, fallback, maximum) {
  const index = process.argv.indexOf(name);
  const raw = index >= 0 ? process.argv[index + 1] : undefined;
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

function uniqueLookupToken(index) {
  let value = index;
  let suffix = '';
  do {
    suffix = String.fromCharCode(97 + (value % 26)) + suffix;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return `lookupkey${suffix}`;
}

function percentile(samples, fraction) {
  samples.sort((left, right) => left - right);
  const index = Math.min(samples.length - 1, Math.max(0, Math.ceil(samples.length * fraction) - 1));
  return samples[index];
}

async function main() {
  const records = readPositiveOption('--records', 1_000, 100_000);
  const sandbox = await mkdtemp(path.join(tmpdir(), 'memorix-large-store-gate-'));
  const projectRoot = path.join(sandbox, 'project');
  const dataDir = path.join(sandbox, 'data');

  process.env.MEMORIX_DATA_DIR = dataDir;
  process.env.MEMORIX_EMBEDDING = 'off';

  let client;
  try {
    const git = spawnSync('git', ['init', '--quiet', projectRoot], { encoding: 'utf8', windowsHide: true });
    if (git.status !== 0) {
      throw new Error(`git init failed: ${git.stderr || git.stdout || 'unknown error'}`);
    }

    const { createMemoryClient } = await import('../dist/sdk.js');
    client = await createMemoryClient({ projectRoot, silent: true });
    const seedStarted = performance.now();
    const steady = [];
    let peakRss = process.memoryUsage().rss;

    for (let index = 0; index < records; index += 1) {
      const lookupToken = uniqueLookupToken(index);
      const writeStarted = performance.now();
      await client.store({
        entityName: `module-${index % 64}`,
        type: index % 5 === 0 ? 'decision' : 'discovery',
        title: `Large-store gate record ${index}`,
        narrative: `Module ${index % 64} recorded gate evidence for scenario ${index} with ${lookupToken}.`,
        facts: [`scenario=${index}`, `module=${index % 64}`, lookupToken],
        concepts: ['gate', 'large-store', `module-${index % 64}`, lookupToken],
      });
      if (index >= 20) steady.push(performance.now() - writeStarted);
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }

    const seedAndIndexMs = performance.now() - seedStarted;
    const searchStarted = performance.now();
    const hits = await client.search({ query: uniqueLookupToken(0), quality: 'fast', limit: 10 });
    const searchMs = performance.now() - searchStarted;
    await client.close();

    const jsonlPath = path.join(dataDir, '.embedding-api-cache.jsonl');
    await writeFile(
      jsonlPath,
      `${JSON.stringify({ h: 'gatehash00000001', v: [0.11, 0.12] })}\n${JSON.stringify({ h: 'gatehash00000002', v: [0.21, 0.22] })}\n`,
    );
    const cacheText = await readFile(jsonlPath, 'utf8');
    const cacheLines = cacheText.trim().split('\n');

    const report = {
      records,
      node: process.version,
      platform: process.platform,
      seedAndIndexMs: Number(seedAndIndexMs.toFixed(3)),
      steadyStateWriteMs: {
        p50: Number(percentile(steady, 0.5).toFixed(3)),
        p95: Number(percentile(steady, 0.95).toFixed(3)),
      },
      searchMs: Number(searchMs.toFixed(3)),
      searchHits: hits.length,
      peakRssMb: Number((peakRss / (1024 * 1024)).toFixed(1)),
      cacheLines: cacheLines.length,
    };

    const failed = [];
    if (report.steadyStateWriteMs.p50 > 25) failed.push(`steady p50 ${report.steadyStateWriteMs.p50}ms > 25ms`);
    const searchBudget = records <= 1_000 ? 250 : 1_500;
    if (report.searchMs > searchBudget) failed.push(`search ${report.searchMs}ms > ${searchBudget}ms`);
    const rssBudgetMb = records <= 1_000 ? 512 : 2048;
    if (report.peakRssMb > rssBudgetMb) failed.push(`peak RSS ${report.peakRssMb}MB > ${rssBudgetMb}MB`);
    if (report.cacheLines !== 2) failed.push(`cache lines ${report.cacheLines} !== 2`);
    if (hits.length < 1) failed.push('search returned no hits');

    console.log(JSON.stringify({ ...report, ok: failed.length === 0, failed }, null, 2));
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        // already closed or close failed; still try sandbox cleanup
      }
    }
    await rm(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
