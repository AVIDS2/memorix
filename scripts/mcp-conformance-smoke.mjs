import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const distCli = path.resolve(root, 'dist', 'cli', 'index.js')
const tempBase = process.env.MEMORIX_TEST_TMPDIR?.trim() || path.join(root, '.tmp-memorix-smoke')
await mkdir(tempBase, { recursive: true })
const tempRoot = await mkdtemp(path.join(tempBase, 'memorix-mcp-conformance-'))
const project = path.join(tempRoot, 'project')
const dataDir = path.join(tempRoot, 'data')
// Keep the target and all optional smoke state isolated under the selected
// temporary directory. The conformance runner is asked for a terminal report
// so its Windows output-folder path handling cannot affect this smoke.
const stderrPath = path.join(tempRoot, 'server.stderr.log')
await mkdir(project, { recursive: true })
await mkdir(dataDir, { recursive: true })
execFileSync('git', ['init', project], { stdio: 'ignore', windowsHide: true })

if (!existsSync(distCli)) throw new Error(`built CLI not found at ${distCli}; run npm run build first`)

const port = 39_500 + Math.floor(Math.random() * 400)
const env = {
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
}

const server = spawn(process.execPath, [
  distCli, 'serve-http', '--cwd', project, '--host', '127.0.0.1', '--port', String(port), '--mode', 'micro',
], {
  cwd: root,
  env,
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
})
let serverStderr = ''
server.stderr.setEncoding('utf8')
server.stderr.on('data', chunk => { serverStderr += chunk })

async function stopServer() {
  if (server.exitCode !== null || !server.pid) return
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
  throw new Error(`conformance target did not become healthy\n${serverStderr}`)
}

function runConformance() {
  const suiteArgs = [
    '-u', `http://127.0.0.1:${port}/mcp`,
    '--spec-version', '2026-07-28',
    '--output', 'stdio',
    '--disable-telemetry=1',
  ]
  // Invoke npm's JS entry directly. On Windows this avoids both npx.cmd's
  // EINVAL spawn edge case and drive-letter arguments being parsed as module
  // URLs by npx's ESM test runner.
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const executable = existsSync(npmCli)
    ? process.execPath
    : (process.platform === 'win32' ? 'npx.cmd' : 'npx')
  const executableArgs = existsSync(npmCli)
    ? [npmCli, 'exec', '--yes', '--package=@hasmcp/mcp-spec-test@latest', '--', 'mcp-spec-test', ...suiteArgs]
    : ['-y', '@hasmcp/mcp-spec-test@latest', ...suiteArgs]
  return new Promise((resolve, reject) => {
    const child = spawn(executable, executableArgs, {
      cwd: root,
      env: { ...process.env, MCP_DISABLE_TELEMETRY: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}

try {
  await waitForHealth()
  const result = await runConformance()
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  assert.equal(result.code, 0, `MCP conformance failed with code ${result.code ?? 'null'}${result.signal ? ` (${result.signal})` : ''}`)
  console.log(JSON.stringify({ smoke: 'passed', transport: 'http', port, conformance: 'stdio-report' }))
} finally {
  await stopServer()
  if (serverStderr && process.env.MEMORIX_KEEP_SMOKE_LOGS === '1') {
    await (await import('node:fs/promises')).writeFile(stderrPath, serverStderr, 'utf8')
  }
  await rm(tempRoot, { recursive: true, force: true })
}
