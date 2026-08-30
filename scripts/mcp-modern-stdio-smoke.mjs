import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const distCli = path.resolve(root, 'dist', 'cli', 'index.js')
const tempBase = process.env.MEMORIX_TEST_TMPDIR?.trim() || path.join(root, '.tmp-memorix-smoke')
await mkdir(tempBase, { recursive: true })
const tempRoot = await mkdtemp(path.join(tempBase, 'memorix-modern-stdio-smoke-'))
const project = path.join(tempRoot, 'project')
const dataDir = path.join(tempRoot, 'data')
await mkdir(project, { recursive: true })
await mkdir(dataDir, { recursive: true })
execFileSync('git', ['init'], { cwd: project, stdio: 'ignore', windowsHide: true })

if (!existsSync(distCli)) throw new Error(`built CLI not found at ${distCli}; run npm run build first`)

const child = spawn(process.execPath, [distCli, 'serve', '--cwd', project, '--mode', 'micro'], {
  cwd: root,
  env: {
    ...process.env,
    HOME: path.dirname(dataDir),
    USERPROFILE: path.dirname(dataDir),
    MEMORIX_DATA_DIR: dataDir,
    MEMORIX_EMBEDDING: 'off',
    MEMORIX_LLM_API_KEY: '',
    OPENAI_API_KEY: '',
    MEMORIX_LLM_PROVIDER: '',
    MEMORIX_LLM_MODEL: '',
    NO_COLOR: '1',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
})

const messages = new Map()
const waiters = new Map()
let buffer = ''
let stderr = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', chunk => {
  buffer += chunk
  let newline = buffer.indexOf('\n')
  while (newline >= 0) {
    const line = buffer.slice(0, newline).replace(/\r$/, '')
    buffer = buffer.slice(newline + 1)
    if (line.trim()) {
      const message = JSON.parse(line)
      const id = String(message.id)
      messages.set(id, message)
      const waiter = waiters.get(id)
      if (waiter) {
        waiters.delete(id)
        waiter(message)
      }
    }
    newline = buffer.indexOf('\n')
  }
})
child.stderr.on('data', chunk => { stderr += chunk })

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`)
}

function waitFor(id, timeoutMs = 30_000) {
  const key = String(id)
  const existing = messages.get(key)
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(key)
      reject(new Error(`timed out waiting for modern stdio response ${key}\n${stderr}`))
    }, timeoutMs)
    waiters.set(key, message => {
      clearTimeout(timer)
      resolve(message)
    })
  })
}

function terminate() {
  if (child.exitCode !== null || !child.pid) return
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } catch {}
  } else {
    child.kill('SIGTERM')
  }
}

const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'memorix-modern-stdio-smoke', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
}

try {
  send({ jsonrpc: '2.0', id: 'discover', method: 'server/discover', params: { _meta: meta } })
  const discovery = await waitFor('discover')
  assert.equal(discovery.error, undefined)
  assert.equal(discovery.result.resultType, 'complete')
  assert.deepEqual(discovery.result.supportedVersions, ['2026-07-28'])

  send({ jsonrpc: '2.0', id: 'list', method: 'tools/list', params: { _meta: meta } })
  const listed = await waitFor('list')
  assert.equal(listed.error, undefined)
  assert.equal(listed.result.resultType, 'complete')
  assert.ok(listed.result.tools.some(tool => tool.name === 'memorix_project_context'))

  send({
    jsonrpc: '2.0',
    id: 'call',
    method: 'tools/call',
    params: { name: 'memorix_codegraph_status', arguments: {}, _meta: meta },
  })
  const called = await waitFor('call')
  assert.equal(called.error, undefined)
  assert.equal(called.result.resultType, 'complete')
  assert.equal(called.result._meta['io.modelcontextprotocol/serverInfo'].name, 'memorix')
  assert.equal(called.result.content[0].type, 'text')

  child.stdin.end()
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`modern stdio child did not exit after EOF\n${stderr}`)), 10_000)
    child.once('exit', code => {
      clearTimeout(timer)
      resolve(code)
    })
  })
  assert.equal(exitCode, 0)
  console.log(JSON.stringify({ smoke: 'passed', transport: 'stdio', modern: true, exitCode }))
} finally {
  terminate()
  await rm(tempRoot, { recursive: true, force: true })
}
