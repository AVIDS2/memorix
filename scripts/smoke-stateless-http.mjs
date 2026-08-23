import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const root = process.cwd();
const cli = path.join(root, 'dist', 'cli', 'index.js');
const home = await mkdtemp(path.join(tmpdir(), 'memorix-1.8-http-home-'));
const projectRoot = await mkdtemp(path.join(tmpdir(), 'memorix-1.8-projects-'));
const dataDir = path.join(home, '.memorix', 'data');
const projectA = path.join(projectRoot, 'project-a');
const projectB = path.join(projectRoot, 'project-b');

async function fakeGit(project, remote) {
  await mkdir(path.join(project, '.git'), { recursive: true });
  await writeFile(path.join(project, '.git', 'config'), `[remote "origin"]\n\turl = ${remote}\n`, 'utf8');
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function start() {
  const port = await freePort();
  const child = spawn(process.execPath, [cli, 'serve-http', '--port', String(port), '--cwd', projectA], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      HOMEPATH: home,
      MEMORIX_DATA_DIR: dataDir,
      MEMORIX_EMBEDDING: 'off',
      __MEMORIX_HEAP: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return { child, port, getLogs: () => stderr };
    } catch {
      // The listener is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`HTTP server did not become ready.\n${stderr.slice(-4000)}`);
}

async function stop(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => { server.child.kill(); resolve(); }, 5_000);
    server.child.once('close', () => { clearTimeout(timer); resolve(); });
    server.child.kill();
  });
}

function headers(extra = {}) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...extra,
  };
}

async function rpc(port, body, extraHeaders = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: headers(extraHeaders),
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch {
    const data = text.split('\n').find(line => line.startsWith('data:'))?.slice(6);
    if (data) json = JSON.parse(data);
  }
  return { response, json, text };
}

function toolText(result) {
  return result?.result?.content?.map(item => item.text ?? '').join('\n') ?? '';
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let server;
try {
  await fakeGit(projectA, 'https://github.com/example/context-a.git');
  await fakeGit(projectB, 'https://github.com/example/context-b.git');
  server = await start();

  const protocol = { 'Mcp-Protocol-Version': '2026-07-28' };
  const statelessInit = await rpc(server.port, {
    jsonrpc: '2.0', method: 'initialize', id: 1,
    params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } },
  }, { ...protocol, 'Mcp-Project-Root': projectA, 'Mcp-Stateless': 'true' });
  assert(statelessInit.response.ok, `stateless initialize failed: ${statelessInit.text}`);
  const handleA = statelessInit.response.headers.get('mcp-project-handle');
  assert(handleA?.startsWith('mxh_'), 'stateless initialize did not return a durable project handle');

  const listA = await rpc(server.port, { jsonrpc: '2.0', method: 'tools/list', id: 2 }, { ...protocol, 'Mcp-Project-Handle': handleA });
  assert(listA.response.ok && listA.json?.result?.tools?.some(tool => tool.name === 'memorix_evidence'), `stateless follow-up did not expose Evidence tool: ${listA.text}`);

  const storedA = await rpc(server.port, {
    jsonrpc: '2.0', method: 'tools/call', id: 3,
    params: { name: 'memorix_store', arguments: { entityName: 'smoke-a', type: 'decision', title: 'Project A memory', narrative: 'A must not leak into B.' } },
  }, { ...protocol, 'Mcp-Project-Handle': handleA });
  assert(storedA.response.ok && !storedA.json?.result?.isError, `stateless store failed: ${storedA.text}`);

  const joinedA = await rpc(server.port, {
    jsonrpc: '2.0', method: 'tools/call', id: 4,
    params: { name: 'team_manage', arguments: { action: 'join', name: 'agent-a', agentType: 'codex', instanceId: 'smoke-a' } },
  }, { ...protocol, 'Mcp-Project-Handle': handleA });
  assert(!joinedA.json?.result?.isError, `project A team join failed: ${joinedA.text}`);

  const statelessInitB = await rpc(server.port, {
    jsonrpc: '2.0', method: 'initialize', id: 5,
    params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'smoke-b', version: '1' } },
  }, { ...protocol, 'Mcp-Project-Root': projectB, 'Mcp-Stateless': 'true' });
  const handleB = statelessInitB.response.headers.get('mcp-project-handle');
  assert(handleB?.startsWith('mxh_'), 'project B did not receive a handle');
  const joinedB = await rpc(server.port, {
    jsonrpc: '2.0', method: 'tools/call', id: 6,
    params: { name: 'team_manage', arguments: { action: 'join', name: 'agent-b', agentType: 'codex', instanceId: 'smoke-b' } },
  }, { ...protocol, 'Mcp-Project-Handle': handleB });
  assert(!joinedB.json?.result?.isError, `project B team join failed: ${joinedB.text}`);
  const statusA = await rpc(server.port, {
    jsonrpc: '2.0', method: 'tools/call', id: 7,
    params: { name: 'team_manage', arguments: { action: 'status' } },
  }, { ...protocol, 'Mcp-Project-Handle': handleA });
  const statusAText = toolText(statusA.json);
  assert(statusAText.includes('agent-a') && !statusAText.includes('agent-b'), 'TeamStore leaked project B agent into project A');

  const legacyInit = await rpc(server.port, {
    jsonrpc: '2.0', method: 'initialize', id: 8,
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'legacy', version: '1' } },
  });
  const legacySession = legacyInit.response.headers.get('mcp-session-id');
  assert(legacyInit.response.ok && legacySession, 'legacy stateful initialize did not return Mcp-Session-Id');
  const legacyList = await rpc(server.port, { jsonrpc: '2.0', method: 'tools/list', id: 9 }, { 'Mcp-Session-Id': legacySession });
  assert(legacyList.response.ok && legacyList.json?.result?.tools?.length > 0, 'legacy stateful tools/list failed');

  await stop(server);
  server = await start();
  const resumed = await rpc(server.port, {
    jsonrpc: '2.0', method: 'tools/call', id: 10,
    params: { name: 'memorix_search', arguments: { query: 'Project A memory', limit: 5 } },
  }, { ...protocol, 'Mcp-Project-Handle': handleA });
  assert(resumed.response.ok && toolText(resumed.json).includes('Project A memory'), 'durable handle did not restore project memory after restart');

  console.log(JSON.stringify({
    ok: true,
    stateless: { handleA, handleB, followUp: true, restartRecovery: true },
    legacyStateful: { sessionIdReturned: true, toolsList: true },
    teamIsolation: true,
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  if (server?.getLogs) console.error(server.getLogs().slice(-4000));
  process.exitCode = 1;
} finally {
  await stop(server);
  await rm(home, { recursive: true, force: true });
  await rm(projectRoot, { recursive: true, force: true });
}
