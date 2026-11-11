import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const distCli = path.resolve(root, 'dist', 'cli', 'index.js')
const tempBase = process.env.MEMORIX_TEST_TMPDIR?.trim() || path.join(root, '.tmp-memorix-smoke')
await mkdir(tempBase, { recursive: true })
const tempRoot = await mkdtemp(path.join(tempBase, 'memorix-background-smoke-'))
const home = path.join(tempRoot, 'home')
const project = path.join(tempRoot, 'project')
const dataDir = path.join(home, '.memorix', 'data')
const port = 38_000 + Math.floor(Math.random() * 1_000)
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
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

function runStart() {
  const child = spawn(process.execPath, [distCli, 'background', 'start', '--port', String(port)], {
    cwd: project,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`background start smoke timed out\nstdout=${stdout}\nstderr=${stderr}`))
    }, 45_000)
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr })
    })
  })
}

async function runCommand(args) {
  const child = spawn(process.execPath, [distCli, ...args], {
    cwd: project,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`command timed out: ${args.join(' ')}`))
    }, 20_000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr })
    })
  })
}

let stopResult
try {
  const [first, second] = await Promise.all([runStart(), runStart()])
  assert.equal(first.code, 0, `first start failed\n${first.stdout}\n${first.stderr}`)
  assert.equal(second.code, 0, `second start failed\n${second.stdout}\n${second.stderr}`)
  assert.match(`${first.stdout}\n${first.stderr}\n${second.stdout}\n${second.stderr}`, /already running|running and healthy/i)

  const state = JSON.parse(await readFile(path.join(home, '.memorix', 'background.json'), 'utf8'))
  assert.ok(Number.isSafeInteger(state.pid) && state.pid > 0)

  const processListing = process.platform === 'win32'
    ? execFileSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      `$needle = 'serve-http --port ${port}'; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*$needle*" } | Select-Object -ExpandProperty CommandLine`,
    ], { encoding: 'utf8', windowsHide: true })
    : execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' })
  const matchingLines = processListing
    .split(/\r?\n/u)
    .filter(line => line.includes(`serve-http --port ${port}`) && !line.toLowerCase().includes('powershell.exe'))
  assert.equal(matchingLines.length, 1, `expected one serve-http process, found ${matchingLines.length}\n${processListing}`)
  console.log(JSON.stringify({ smoke: 'passed', port, pid: state.pid, serveHttpProcesses: matchingLines.length }))
} finally {
  stopResult = await runCommand(['background', 'stop', '--port', String(port)]).catch(error => ({ code: 1, error: String(error) }))
  if (stopResult.code !== 0) console.error(JSON.stringify({ stopResult }))
  await rm(tempRoot, { recursive: true, force: true })
}
