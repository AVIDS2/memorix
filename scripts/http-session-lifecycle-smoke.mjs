import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

// Exercise the built production host outside Git, with an isolated home/store.
const sandbox = await mkdtemp(path.join(tmpdir(), 'memorix-session-smoke-'));
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const cli = path.resolve('dist/cli/index.js');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const grace = 300;
const child = spawn(process.execPath, [cli, 'serve-http', '--port', String(port), '--cwd', sandbox], {
  cwd: sandbox, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
  env: {
    ...process.env, HOME: sandbox, USERPROFILE: sandbox, HOMEPATH: sandbox,
    MEMORIX_DATA_DIR: path.join(sandbox, 'data'), MEMORIX_EMBEDDING: 'off',
    MEMORIX_SESSION_DISCONNECT_GRACE_MS: String(grace),
    MEMORIX_AUTO_UPDATE: '0', __MEMORIX_HEAP: '1',
  },
});
let logs = '';
child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
const base = `http://127.0.0.1:${port}`;
const streams = [];
let requestId = 0;

async function post(method, sessionId, params = {}) {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(method.startsWith('notifications/') ? {} : { id: ++requestId }) }),
  });
  const text = await response.text();
  return { response, text };
}

async function initialize() {
  const { response, text } = await post('initialize', undefined, {
    protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: { name: 'session-lifecycle-smoke', version: '1' },
  });
  assert.equal(response.status, 200, text);
  const sid = response.headers.get('mcp-session-id');
  assert.ok(sid);
  assert.equal((await post('notifications/initialized', sid)).response.status, 202);
  return sid;
}

async function openStream(sid) {
  const controller = new AbortController();
  const response = await fetch(`${base}/mcp`, {
    headers: { Accept: 'text/event-stream', 'Mcp-Session-Id': sid }, signal: controller.signal,
  });
  assert.equal(response.status, 200);
  // Consume continuously so client-side buffering does not close an idle stream.
  const reading = (async () => { for await (const _ of response.body) { /* drain */ } })().catch(() => {});
  const stream = { close: async () => { controller.abort(); await reading; } };
  streams.push(stream);
  return stream;
}

try {
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${logs}`);
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
      await response.text();
      if (response.ok) { ready = true; break; }
    } catch { /* listener starting */ }
    await pause(100);
  }
  assert.ok(ready, logs);

  const latencies = [];
  for (let i = 0; i < 3; i++) {
    const started = performance.now();
    const response = await fetch(`${base}/mcp`, {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        'Mcp-Protocol-Version': '2026-07-28', 'Mcp-Method': 'server/discover',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'server/discover', id: ++requestId,
        params: { _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'smoke', version: '1' },
          'io.modelcontextprotocol/clientCapabilities': {},
        } },
      }),
    });
    const text = await response.text();
    assert.equal(response.status, 200, text);
    latencies.push(Math.round(performance.now() - started));
  }

  const gone = await initialize();
  await (await openStream(gone)).close();
  const connected = await initialize();
  await openStream(connected);
  const postOnly = await initialize();
  const active = await initialize();
  await (await openStream(active)).close();
  const reconnected = await initialize();
  await (await openStream(reconnected)).close();
  await openStream(reconnected);

  await pause(grace / 2);
  assert.equal((await post('ping', active)).response.status, 200);
  await pause(grace * 2);
  const expired = await post('ping', gone);
  assert.equal(expired.response.status, 404, expired.text);
  assert.match(expired.text, /expired/i);
  for (const sid of [connected, postOnly, active, reconnected]) {
    const result = await post('ping', sid);
    assert.equal(result.response.status, 200, result.text);
  }
  console.log(JSON.stringify({ result: 'passed', disconnected: '404 expired',
    connected: 'retained', postOnly: 'retained', postAfterClose: 'retained', reconnect: 'retained',
    nonGitDiscoveryMs: latencies }));
} finally {
  await Promise.all(streams.map(stream => stream.close()));
  if (child.exitCode === null) {
    const closed = once(child, 'close');
    child.kill();
    await closed;
  }
  await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
