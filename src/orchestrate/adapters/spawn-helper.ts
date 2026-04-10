/**
 * Shared spawn logic for agent adapters.
 *
 * Encapsulates: child_process.spawn, ring buffer wiring,
 * timeout handling, and abort/SIGKILL escalation.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { RingBuffer } from '../ring-buffer.js';
import type { AgentProcess, AgentProcessResult, SpawnOptions } from './types.js';

const DEFAULT_TIMEOUT_MS = 600_000;  // 10 minutes
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

  // Write prompt via stdin to avoid shell argument escaping issues
  if (stdinData && child.stdin) {
    child.stdin.write(stdinData);
    child.stdin.end();
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
      resolve({
        exitCode: code,
        signal: signal ?? null,
        tailOutput: ring.toString(),
        killed,
      });
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: null,
        signal: null,
        tailOutput: `spawn error: ${err.message}\n${ring.toString()}`,
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
