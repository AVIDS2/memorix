import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { performance } from 'node:perf_hooks'
import path from 'node:path'
import process from 'node:process'
import assert from 'node:assert/strict'

const root = process.cwd()
const distCli = path.resolve(root, 'dist', 'cli', 'index.js')
const timeoutMs = 10_000

function terminate(child) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } catch {
      // The process may already have exited.
    }
    return
  }
  child.kill('SIGTERM')
}

function waitForMessage(messages, id, timeout = timeoutMs) {
  if (messages.has(id)) return Promise.resolve(messages.get(id))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      messages.waiters.delete(id)
      reject(new Error(`timed out waiting for JSON-RPC response ${id}`))
    }, timeout)
    messages.waiters.set(id, (message) => {
      clearTimeout(timer)
      resolve(message)
    })
  })
}

function startServer(projectRoot, dataDir) {
  const start = performance.now()
  const child = spawn(process.execPath, [distCli, 'serve', '--cwd', projectRoot, '--mode', 'micro'], {
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
  messages.waiters = new Map()
  let stdout = ''
  let stderr = ''
  let protocolNoise = ''
  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      buffer = buffer.slice(newline + 1)
      if (line.trim()) {
        try {
          const message = JSON.parse(line)
          messages.set(String(message.id), message)
          const waiter = messages.waiters.get(String(message.id))
          if (waiter) {
            messages.waiters.delete(String(message.id))
            waiter(message)
          }
        } catch {
          protocolNoise += line
        }
      }
      newline = buffer.indexOf('\n')
    }
  })
  child.stderr.on('data', (chunk) => { stderr += chunk })

  const send = (message) => {
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }
  const wait = (id) => waitForMessage(messages, id)
  const closeInput = () => child.stdin.end()
  const waitForExit = (timeout = 5_000) => new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode)
      return
    }
    const timer = setTimeout(() => reject(new Error('stdio child did not exit after stdin EOF')), timeout)
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
  const close = () => terminate(child)
  const elapsed = () => Math.round(performance.now() - start)
  return { child, send, wait, closeInput, waitForExit, close, elapsed, getOutput: () => ({ stdout, stderr, protocolNoise }) }
}

async function main() {
  assert.equal(await import('node:fs/promises').then(() => true), true)
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'memorix-mcp-stdio-smoke-'))
  const projectRoot = path.join(tempRoot, 'project')
  const dataDir = path.join(tempRoot, 'data')
  await mkdir(projectRoot, { recursive: true })
  await mkdir(dataDir, { recursive: true })
  execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore', windowsHide: true })

  if (!process.env.CI && !process.env.MEMORIX_SMOKE_SKIP_BUILD_CHECK && !await import('node:fs').then(({ existsSync }) => existsSync(distCli))) {
    throw new Error(`built CLI not found at ${distCli}; run npm run build first`)
  }

  const server = startServer(projectRoot, dataDir)
  try {
    const discoverId = 'smoke-discover'
    server.send({ jsonrpc: '2.0', id: discoverId, method: 'server/discover' })
    const discovery = await server.wait(discoverId)
    assert.ok(server.elapsed() <= timeoutMs, `discover responded after ${server.elapsed()}ms`)
    assert.equal(discovery.error, undefined)
    assert.equal(discovery.result.resultType, 'complete')
    assert.deepEqual(discovery.result._meta['io.modelcontextprotocol/serverInfo'].name, 'memorix')
    assert.ok(discovery.result.supportedVersions.includes('2026-07-28'))

    const listId = 'smoke-list'
    const callId = 'smoke-call'
    const initializeId = 'smoke-initialize'
    server.send({ jsonrpc: '2.0', id: listId, method: 'tools/list' })
    server.send({
      jsonrpc: '2.0',
      id: callId,
      method: 'tools/call',
      params: { name: 'memorix_codegraph_status', arguments: {} },
    })
    server.send({
      jsonrpc: '2.0',
      id: initializeId,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'memorix-stdio-smoke', version: '1' },
      },
    })

    const [list, call, initialize] = await Promise.all([
      server.wait(listId),
      server.wait(callId),
      server.wait(initializeId),
    ])
    assert.equal(list.error, undefined)
    assert.ok(list.result.tools.some((tool) => tool.name === 'memorix_codegraph_status'))
    assert.equal(call.error, undefined)
    assert.equal(call.result.content[0].type, 'text')
    assert.equal(initialize.error, undefined)
    assert.equal(initialize.result.protocolVersion, '2025-11-25')
    assert.equal(server.getOutput().protocolNoise, '')
    server.closeInput()
    const exitCode = await server.waitForExit()
    assert.equal(exitCode, 0)
    console.log(JSON.stringify({
      smoke: 'passed',
      discoverMs: server.elapsed(),
      toolCount: list.result.tools.length,
      exitCode,
      stderrBytes: server.getOutput().stderr.length,
      stdoutBytes: server.getOutput().stdout.length,
    }))
  } finally {
    server.close()
    await rm(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
