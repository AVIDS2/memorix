#!/usr/bin/env node

/*
 * Reproducible hot-path retrieval measurement.
 *
 * This exercises the public SDK in one process after seeding a temporary Git
 * project. It intentionally uses the fast profile with embeddings disabled,
 * so its numbers describe local lexical retrieval only, not CLI startup, MCP
 * transport, remote embedding, or LLM provider latency.
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

function percentile(samples, fraction) {
  const index = Math.min(samples.length - 1, Math.max(0, Math.ceil(samples.length * fraction) - 1));
  return samples[index];
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

function summarize(samples) {
  samples.sort((left, right) => left - right);
  return {
    min: Number(samples[0].toFixed(3)),
    p50: Number(percentile(samples, 0.5).toFixed(3)),
    p95: Number(percentile(samples, 0.95).toFixed(3)),
    p99: Number(percentile(samples, 0.99).toFixed(3)),
    max: Number(samples.at(-1).toFixed(3)),
  };
}

async function measureSearch(client, runs, queryForRun) {
  for (let index = 0; index < Math.min(20, runs); index += 1) {
    await client.search({ query: queryForRun(index), quality: 'fast', limit: 10 });
  }

  const samples = [];
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    await client.search({ query: queryForRun(index), quality: 'fast', limit: 10 });
    samples.push(performance.now() - started);
  }
  return summarize(samples);
}

async function packageVersion() {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  return pkg.version;
}

async function main() {
  const records = readPositiveOption('--records', 1_000, 100_000);
  const runs = readPositiveOption('--runs', 100, 10_000);
  const sandbox = await mkdtemp(path.join(tmpdir(), 'memorix-retrieval-benchmark-'));
  const projectRoot = path.join(sandbox, 'project');
  const dataDir = path.join(sandbox, 'data');

  process.env.MEMORIX_DATA_DIR = dataDir;
  process.env.MEMORIX_EMBEDDING = 'off';

  try {
    const git = spawnSync('git', ['init', '--quiet', projectRoot], { encoding: 'utf8', windowsHide: true });
    if (git.status !== 0) {
      throw new Error(`git init failed: ${git.stderr || git.stdout || 'unknown error'}`);
    }

    const { createMemoryClient } = await import('../dist/sdk.js');
    const client = await createMemoryClient({ projectRoot, silent: true });
    const seedStarted = performance.now();

    for (let index = 0; index < records; index += 1) {
      const lookupToken = uniqueLookupToken(index);
      await client.store({
        entityName: `module-${index % 64}`,
        type: index % 5 === 0 ? 'decision' : 'discovery',
        title: `Retrieval benchmark record ${index}`,
        narrative: `Module ${index % 64} recorded deterministic retrieval evidence for scenario ${index} with ${lookupToken}.`,
        facts: [`scenario=${index}`, `module=${index % 64}`, lookupToken],
        concepts: ['benchmark', 'retrieval', `module-${index % 64}`, lookupToken],
      });
    }
    const seedAndIndexMs = performance.now() - seedStarted;

    const specific = await measureSearch(client, runs, (index) => uniqueLookupToken(index % records));
    const broad = await measureSearch(client, runs, () => 'retrieval evidence');
    await client.close();

    console.log(JSON.stringify({
      version: await packageVersion(),
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      records,
      runs,
      mode: 'hot in-process SDK lexical retrieval; fast profile; embeddings and LLM disabled',
      seedAndIndexMs: Number(seedAndIndexMs.toFixed(3)),
      latencyMs: {
        specific,
        broad,
      },
    }, null, 2));
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
