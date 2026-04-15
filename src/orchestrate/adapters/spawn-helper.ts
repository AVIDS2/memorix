/**
 * Shared spawn logic for agent adapters.
 *
 * Encapsulates: child_process.spawn, ring buffer wiring,
 * timeout handling, and abort/SIGKILL escalation.
 */

import { spawn as nodeSpawn, execSync } from 'node:child_process';
import { RingBuffer } from '../ring-buffer.js';
import type { AgentProcess, AgentProcessResult, AgentMessage, SpawnOptions } from './types.js';

const DEFAULT_TIMEOUT_MS = 600_000;  // 10 minutes

/**
 * Check if a CLI command is available on the system PATH.
 *
 * Uses `where` (Windows) or `which` (Unix) instead of `--version`
 * because npm global installs create `.ps1`/`.cmd` wrappers that
 * Node.js `execSync` cannot invoke without a shell on Windows.
 */
export function isCommandAvailable(command: string): boolean {
  const probe = process.platform === 'win32' ? `where ${command}` : `which ${command}`;
  try {
    execSync(probe, { stdio: 'ignore', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}
const DEFAULT_TAIL_LINES = 50;
const SIGKILL_GRACE_MS = 5_000;

export function spawnAgent(
  command: string,
  args: string[],
  opts: SpawnOptions,
  /** If provided, write this to stdin then close it (avoids shell escaping issues) */
  stdinData?: string,
): AgentProcess {
  const child = nodeSpawn(command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: [stdinData ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    // Windows: use shell to resolve CLI tools on PATH
    shell: process.platform === 'win32',
  });

  // Write prompt via stdin to avoid shell argument escaping issues.
  // Must handle EPIPE / early-close — if the child exits before we finish
  // writing (bad args, crash, etc.), write() would emit an unhandled error
  // that kills the orchestrator process.
  let stdinError: string | undefined;
  if (stdinData && child.stdin) {
    child.stdin.on('error', (err: NodeJS.ErrnoException) => {
      // Swallow EPIPE and other write errors — they are expected when
      // the child process closes stdin early. Record for diagnostics.
      stdinError = `stdin write error: ${err.code ?? err.message}`;
    });
    child.stdin.write(stdinData, () => {
      try { child.stdin!.end(); } catch { /* already destroyed */ }
    });
  }

  const ring = new RingBuffer(opts.tailLines ?? DEFAULT_TAIL_LINES);
  child.stdout?.on('data', (chunk: Buffer) => ring.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => ring.push(chunk.toString()));

  let killed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      killed = true;
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already dead */ } }, SIGKILL_GRACE_MS);
    }, timeoutMs);
  }

  const completion = new Promise<AgentProcessResult>((resolve) => {
    child.on('exit', (code, signal) => {
      if (timer) clearTimeout(timer);
      const tail = stdinError ? `${stdinError}\n${ring.toString()}` : ring.toString();
      resolve({
        exitCode: code,
        signal: signal ?? null,
        tailOutput: tail,
        killed,
      });
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      const tail = stdinError ? `${stdinError}\n` : '';
      resolve({
        exitCode: null,
        signal: null,
        tailOutput: `${tail}spawn error: ${err.message}\n${ring.toString()}`,
        killed: false,
      });
    });
  });

  return {
    pid: child.pid ?? -1,
    completion,
    abort() {
      killed = true;
      if (timer) clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already dead */ } }, SIGKILL_GRACE_MS);
    },
  };
}

/**
 * Spawn agent with streaming stdout line parser.
 *
 * Returns an AgentProcess whose `messages` field is an AsyncIterable<AgentMessage>
 * driven by a per-line callback on stdout. The onStdoutLine callback should parse
 * each line and return AgentMessage[] events (empty array = skip).
 *
 * stderr still goes to ring buffer only. tailOutput still works.
 */
export function spawnAgentWithStream(
  command: string,
  args: string[],
  opts: SpawnOptions,
  stdinData: string | undefined,
  onStdoutLine: (line: string) => AgentMessage[],
  onCompletion?: (result: AgentProcessResult) => AgentProcessResult,
): AgentProcess {
  const child = nodeSpawn(command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: [stdinData ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  let stdinError: string | undefined;
  if (stdinData && child.stdin) {
    child.stdin.on('error', (err: NodeJS.ErrnoException) => {
      stdinError = `stdin write error: ${err.code ?? err.message}`;
    });
    child.stdin.write(stdinData, () => {
      try { child.stdin!.end(); } catch { /* already destroyed */ }
    });
  }

  const ring = new RingBuffer(opts.tailLines ?? DEFAULT_TAIL_LINES);
  child.stderr?.on('data', (chunk: Buffer) => ring.push(chunk.toString()));

  // ── Message queue for AsyncIterable ──
  type Waiter = { resolve: (v: IteratorResult<AgentMessage>) => void };
  const MAX_BUFFER_SIZE = 1024;
  const buffer: AgentMessage[] = [];
  const waiters: Waiter[] = [];
  let done = false;

  function pushMessage(msg: AgentMessage): void {
    if (waiters.length > 0) {
      const w = waiters.shift()!;
      w.resolve({ value: msg, done: false });
    } else {
      if (buffer.length >= MAX_BUFFER_SIZE) {
        // Drop oldest message to prevent unbounded growth
        buffer.shift();
      }
      buffer.push(msg);
    }
  }

  function closeStream(): void {
    done = true;
    for (const w of waiters) {
      w.resolve({ value: undefined as unknown as AgentMessage, done: true });
    }
    waiters.length = 0;
  }

  const messages: AsyncIterable<AgentMessage> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<AgentMessage>> {
          if (buffer.length > 0) {
            return Promise.resolve({ value: buffer.shift()!, done: false });
          }
          if (done) {
            return Promise.resolve({ value: undefined as unknown as AgentMessage, done: true });
          }
          return new Promise<IteratorResult<AgentMessage>>(resolve => {
            waiters.push({ resolve });
          });
        },
      };
    },
  };

  // ── Stdout line parsing ──
  let stdoutPartial = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    ring.push(text);
    stdoutPartial += text;
    const lines = stdoutPartial.split('\n');
    stdoutPartial = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msgs = onStdoutLine(line);
        for (const m of msgs) pushMessage(m);
      } catch { /* skip unparseable lines */ }
    }
  });

  let killed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      killed = true;
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already dead */ } }, SIGKILL_GRACE_MS);
    }, timeoutMs);
  }

  const completion = new Promise<AgentProcessResult>((resolve) => {
    let exitCode: number | null = null;
    let exitSignal: string | null = null;
    let exited = false;
    let stdoutClosed = false;
    let stderrClosed = false;

    function tryResolve(): void {
      // Only resolve after both: process exited AND stdout/stderr fully drained
      if (!exited || !stdoutClosed || !stderrClosed) return;
      if (timer) clearTimeout(timer);
      // Process any remaining partial line
      if (stdoutPartial.trim()) {
        try {
          const msgs = onStdoutLine(stdoutPartial);
          for (const m of msgs) pushMessage(m);
        } catch { /* skip */ }
      }
      closeStream();
      const tail = stdinError ? `${stdinError}\n${ring.toString()}` : ring.toString();
      const baseResult: AgentProcessResult = { exitCode, signal: exitSignal, tailOutput: tail, killed };
      resolve(onCompletion ? onCompletion(baseResult) : baseResult);
    }

    child.on('exit', (code, signal) => {
      exited = true;
      exitCode = code;
      exitSignal = signal ?? null;
      tryResolve();
    });
    child.stdout?.on('close', () => { stdoutClosed = true; tryResolve(); });
    child.stderr?.on('close', () => { stderrClosed = true; tryResolve(); });
    // Fallback: if stdout/stderr are null (e.g. inherited), mark closed immediately
    if (!child.stdout) { stdoutClosed = true; }
    if (!child.stderr) { stderrClosed = true; }

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      closeStream();
      const tail = stdinError ? `${stdinError}\n` : '';
      resolve({
        exitCode: null, signal: null,
        tailOutput: `${tail}spawn error: ${err.message}\n${ring.toString()}`,
        killed: false,
      });
    });
  });

  return {
    pid: child.pid ?? -1,
    completion,
    messages,
    abort() {
      killed = true;
      if (timer) clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already dead */ } }, SIGKILL_GRACE_MS);
    },
  };
}
