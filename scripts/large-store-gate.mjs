#!/usr/bin/env node

/*
 * Reproducible large-store acceptance gate.
 *
 * Measures the same seedAndIndex path as scripts/benchmark-retrieval.mjs,
 * plus steady-state write latency, search, peak RSS, and cache integrity.
 * After the SDK seed closes, this also writes via HTTP MCP and `memorix hook`
 * in child processes, then reopens the SDK in this same Node process.
 *
 *   node scripts/large-store-gate.mjs
 *   node scripts/large-store-gate.mjs --records 40000
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliEntry = path.join(repoRoot, 'dist/cli/index.js');

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

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.on('error', reject);
  });
}

function waitForListening(child, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => {
      reject(new Error(`serve-http did not start within ${timeoutMs}ms. stderr:\n${stderr}`));
    }, timeoutMs);
    const onData = (chunk) => {
      stderr += chunk.toString();
      if (stderr.includes('listening')) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`serve-http exited early (code ${code}). stderr:\n${stderr}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stderr?.off('data', onData);
      child.off('exit', onExit);
    };
    child.stderr?.on('data', onData);
    child.on('exit', onExit);
    child.on('error', (error) => {
      cleanup();
      reject(error);
    });
  });
}

function waitForExit(child, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolve();
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function mcpPost(port, body, sessionId) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  const dataLines = text.split('\n').filter((line) => line.startsWith('data:'));
  if (dataLines.length > 0) {
    try {
      json = JSON.parse(dataLines[0].replace('data: ', ''));
    } catch {
      // not JSON
    }
  }
  if (!json && response.headers.get('content-type')?.includes('application/json')) {
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON
    }
  }
  return { status: response.status, headers: response.headers, text, json };
}

function toolText(result) {
  const content = result?.json?.result?.content;
  if (!Array.isArray(content)) return result.text ?? '';
  return content.map((part) => part.text ?? '').join('\n');
}

async function storeViaHttpMcp(port, projectRoot) {
  const init = await mcpPost(port, {
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'large-store-gate', version: '1.0' },
    },
    id: 1,
  });
  const sessionId = init.headers.get('mcp-session-id');
  if (!sessionId) {
    throw new Error(`HTTP MCP initialize returned no session id: ${init.text}`);
  }
  await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Mcp-Session-Id': sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });

  const started = await mcpPost(port, {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'memorix_session_start',
      arguments: { agent: 'large-store-gate', projectRoot },
    },
    id: 2,
  }, sessionId);
  if (started.json?.result?.isError) {
    throw new Error(`HTTP MCP session_start failed: ${toolText(started)}`);
  }

  const stored = await mcpPost(port, {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'memorix_store',
      arguments: {
        entityName: 'large-store-mcp',
        type: 'discovery',
        title: 'MCP marker 1',
        narrative: 'HTTP MCP write after the SDK client closed. The next SDK open must see this row.',
      },
    },
    id: 3,
  }, sessionId);
  if (stored.json?.result?.isError) {
    throw new Error(`HTTP MCP memorix_store failed: ${toolText(stored)}`);
  }
}

function storeViaHook(projectRoot, dataDir, childHome) {
  const hookFile = path.join(projectRoot, 'src', 'gate-hook.ts');
  const payload = {
    hook_event_name: 'PostToolUse',
    session_id: 'large-store-gate-hook',
    cwd: projectRoot,
    tool_name: 'Write',
    tool_input: {
      file_path: hookFile,
      content: [
        'export function largeStoreHookMarker(): string {',
        '  return "large-store-hook-marker";',
        '}',
        'export const largeStoreHookFacts = [',
        '  "PostToolUse must persist after the SDK client released SQLite",',
        '  "The next in-process SDK open must reload this hook row",',
        '];',
      ].join('\n'),
    },
    tool_response: 'File written successfully',
  };
  const result = spawnSync(process.execPath, [cliEntry, 'hook', '--agent', 'claude'], {
    cwd: projectRoot,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20_000,
    env: {
      ...process.env,
      MEMORIX_DATA_DIR: dataDir,
      MEMORIX_EMBEDDING: 'off',
      HOME: childHome,
      USERPROFILE: childHome,
      HOMEPATH: childHome,
    },
  });
  if (result.status !== 0) {
    throw new Error(`memorix hook failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
}

function listDiskObservations(dataDir) {
  const require = createRequire(import.meta.url);
  function openDatabase(dbPath) {
    try {
      const Database = require('better-sqlite3');
      return new Database(dbPath);
    } catch {
      // Native binding may be compiled for a different Node than this process.
    }
    return new (require('node:sqlite').DatabaseSync)(dbPath);
  }
  const db = openDatabase(path.join(dataDir, 'memorix.db'));
  try {
    return db.prepare('SELECT title, sourceDetail, visibility FROM observations').all();
  } finally {
    db.close();
  }
}

async function writeAcrossTransports(projectRoot, dataDir, sandbox) {
  const childHome = path.join(sandbox, 'home');
  await mkdir(path.join(projectRoot, 'src'), { recursive: true });
  await mkdir(childHome, { recursive: true });
  await writeFile(
    path.join(projectRoot, 'src', 'gate-hook.ts'),
    'export function largeStoreHookMarker(): string { return "large-store-hook-marker"; }\n',
  );

  const port = await allocatePort();
  const server = spawn(process.execPath, [cliEntry, 'serve-http', '--port', String(port), '--cwd', projectRoot], {
    cwd: projectRoot,
    env: {
      ...process.env,
      MEMORIX_DATA_DIR: dataDir,
      MEMORIX_EMBEDDING: 'off',
      HOME: childHome,
      USERPROFILE: childHome,
      HOMEPATH: childHome,
      // Skip the CLI heap respawn so this child is the listener we can stop.
      __MEMORIX_HEAP: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  try {
    await waitForListening(server);
    await storeViaHttpMcp(port, projectRoot);
  } finally {
    try { server.kill('SIGKILL'); } catch { /* already gone */ }
    await waitForExit(server);
  }

  storeViaHook(projectRoot, dataDir, childHome);
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
    client = undefined;

    await writeAcrossTransports(projectRoot, dataDir, sandbox);
    const diskRows = listDiskObservations(dataDir);
    const diskCount = diskRows.length;
    client = await createMemoryClient({ projectRoot, silent: true });
    const reopenedCount = await client.count();
    const reopened = await client.getAll();
    await client.close();
    client = undefined;

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
        p50: Number((steady.length ? percentile(steady, 0.5) : 0).toFixed(3)),
        p95: Number((steady.length ? percentile(steady, 0.95) : 0).toFixed(3)),
      },
      searchMs: Number(searchMs.toFixed(3)),
      searchHits: hits.length,
      peakRssMb: Number((peakRss / (1024 * 1024)).toFixed(1)),
      cacheLines: cacheLines.length,
      diskCount,
      reopenedCount,
    };

    const failed = [];
    if (report.steadyStateWriteMs.p50 > 25) failed.push(`steady p50 ${report.steadyStateWriteMs.p50}ms > 25ms`);
    const searchBudget = records <= 1_000 ? 250 : 1_500;
    if (report.searchMs > searchBudget) failed.push(`search ${report.searchMs}ms > ${searchBudget}ms`);
    const rssBudgetMb = records <= 1_000 ? 512 : 2048;
    if (report.peakRssMb > rssBudgetMb) failed.push(`peak RSS ${report.peakRssMb}MB > ${rssBudgetMb}MB`);
    if (report.cacheLines !== 2) failed.push(`cache lines ${report.cacheLines} !== 2`);
    if (hits.length < 1) failed.push('search returned no hits');
    if (diskCount < records + 2) failed.push(`SQLite count ${diskCount} < ${records + 2} after MCP/hook writes`);
    if (!diskRows.some((row) => row.title === 'MCP marker 1')) {
      failed.push('SQLite missed the HTTP MCP marker');
    }
    if (!diskRows.some((row) => row.sourceDetail === 'hook')) {
      failed.push('SQLite missed the hook write');
    }
    if (reopenedCount <= records) {
      failed.push(`reopened SDK count ${reopenedCount} stayed at the pre-close snapshot of ${records}`);
    }
    if (!reopened.some((row) => row.title === 'MCP marker 1')) {
      failed.push('reopened SDK missed the HTTP MCP marker');
    }

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
