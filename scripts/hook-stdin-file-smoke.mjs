import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, fstatSync } from 'node:fs'
import { mkdtemp, mkdir, open, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = process.cwd()
const distCli = path.resolve(root, 'dist', 'cli', 'index.js')
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'memorix-hook-stdin-file-'))
const project = path.join(tempRoot, 'project')
const dataDir = path.join(tempRoot, 'data')
const payloadPath = path.join(tempRoot, 'hook.json')
let inputFile

try {
  await mkdir(project, { recursive: true })
  execFileSync('git', ['init', '--quiet'], { cwd: project, stdio: 'ignore', windowsHide: true })
  assert.ok(existsSync(distCli), `built CLI not found at ${distCli}; run npm run build first`)

  const payload = {
    hook_event_name: 'pi.agent_end',
    session_id: 'node26-regular-file-stdin-smoke',
    cwd: project,
    ai_response: 'Fixed the Git detection failure by preserving standard input, then verified the hook lifecycle with a focused regression test.',
  }
  await writeFile(payloadPath, JSON.stringify(payload))
  inputFile = await open(payloadPath, 'r')
  assert.equal(fstatSync(inputFile.fd).isFile(), true, 'hook stdin must be backed by a regular file')

  const child = spawn(process.execPath, [distCli, 'hook', '--agent', 'pi'], {
    cwd: project,
    env: {
      ...process.env,
      HOME: tempRoot,
      USERPROFILE: tempRoot,
      MEMORIX_DATA_DIR: dataDir,
      MEMORIX_EMBEDDING: 'off',
      MEMORIX_LLM_API_KEY: '',
      OPENAI_API_KEY: '',
      MEMORIX_LLM_PROVIDER: '',
      MEMORIX_LLM_MODEL: '',
      MEMORIX_HOOK_TIMEOUT_MS: '30000',
      NO_COLOR: '1',
    },
    stdio: [inputFile.fd, 'pipe', 'pipe'],
    windowsHide: true,
  })

  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, 45_000)
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  }).finally(() => clearTimeout(timer))

  assert.equal(timedOut, false, `hook timed out\n${stderr}`)
  assert.equal(result.code, 0, `hook exited with ${result.code} (${result.signal})\n${stderr}`)
  assert.deepEqual(JSON.parse(stdout), { continue: true })
  assert.doesNotMatch(stderr, /\[memorix\] hook store failed/i, stderr)
  assert.ok((await readdir(dataDir)).length > 0, 'the response observation should reach project detection and storage')
  console.log(JSON.stringify({ smoke: 'passed', stdin: 'regular-file', agent: 'pi', exitCode: result.code }))
} finally {
  await inputFile?.close()
  await rm(tempRoot, { recursive: true, force: true })
}
