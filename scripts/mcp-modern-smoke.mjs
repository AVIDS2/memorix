import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const distCli = path.resolve(root, 'dist', 'cli', 'index.js')
const tempBase = process.env.MEMORIX_TEST_TMPDIR?.trim() || path.join(root, '.tmp-memorix-smoke')
await mkdir(tempBase, { recursive: true })
const tempRoot = await mkdtemp(path.join(tempBase, 'memorix-modern-smoke-'))
const project = path.join(tempRoot, 'project')
const dataDir = path.join(tempRoot, 'data')
const port = 39_000 + Math.floor(Math.random() * 1_000)
const env = {
  ...process.env,
  MEMORIX_DATA_DIR: dataDir,
  MEMORIX_EMBEDDING: 'off',
  MEMORIX_LLM_API_KEY: '',
  OPENAI_API_KEY: '',
  MEMORIX_LLM_PROVIDER: '',
  MEMORIX_LLM_MODEL: '',
  NO_COLOR: '1',
}

await mkdir(project, { recursive: true })
await mkdir(dataDir, { recursive: true })
execFileSync('git', ['init'], { cwd: project, stdio: 'ignore', windowsHide: true })

const server = spawn(process.execPath, [distCli, 'serve-http', '--cwd', project, '--host', '127.0.0.1', '--port', String(port), '--mode', 'micro'], {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
let stderr = ''
server.stderr.setEncoding('utf8')
server.stderr.on('data', chunk => { stderr += chunk })
server.stdout.resume()

async function stop() {
  if (server.exitCode !== null) return
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/F', '/T', '/PID', String(server.pid)], { stdio: 'ignore', windowsHide: true }) } catch {}
  } else {
    server.kill('SIGTERM')
  }
  await new Promise(resolve => server.once('exit', resolve))
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`modern MCP server did not become healthy\n${stderr}`)
}

const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'memorix-modern-smoke', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
}

async function request(method, id, params = {}) {
  const headers = {
    'content-type': 'application/json',
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': method,
  }
  if (method === 'tools/call' && typeof params.name === 'string') headers['mcp-name'] = params.name
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: meta } }),
  })
  return { response, body: await response.json() }
}

try {
  await waitForHealth()
  const legacyProbeResponse = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'legacy-discover', method: 'server/discover' }),
  })
  const legacyProbe = await legacyProbeResponse.json()
  assert.equal(legacyProbeResponse.status, 200)
  assert.deepEqual(legacyProbe.result.supportedVersions, ['2025-11-25', '2024-11-05'])

  const discovery = await request('server/discover', 'discover')
  assert.equal(discovery.response.status, 200)
  assert.equal(discovery.body.result.resultType, 'complete')
  assert.deepEqual(discovery.body.result.supportedVersions, ['2026-07-28'])
  assert.equal(discovery.body.result._meta['io.modelcontextprotocol/serverInfo'].name, 'memorix')

  const listed = await request('tools/list', 'list')
  assert.equal(listed.response.status, 200)
  assert.equal(listed.body.result.resultType, 'complete')
  assert.ok(listed.body.result.tools.some(tool => tool.name === 'memorix_project_context'))

  const called = await request('tools/call', 'call', { name: 'memorix_codegraph_status', arguments: {} })
  assert.equal(called.response.status, 200)
  assert.equal(called.body.result.resultType, 'complete')
  assert.equal(called.body.result._meta['io.modelcontextprotocol/serverInfo'].name, 'memorix')
  assert.equal(called.body.result.content[0].type, 'text')

  console.log(JSON.stringify({ smoke: 'passed', transport: 'http', port, modern: true }))
} finally {
  await stop()
  await rm(tempRoot, { recursive: true, force: true })
}
