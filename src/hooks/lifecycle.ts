/**
 * Process-level lifecycle for `memorix hook`.
 *
 * Hosts invoke this command on every agent event. It must read stdin, emit
 * one JSON object, and exit. Leftover hook processes are a bug: they reserve
 * heap, orphan onto PID 1, and can exhaust a laptop.
 */

import type { ObservationRuntimeOptions } from '../memory/observations.js';

export const DEFAULT_HOOK_TIMEOUT_MS = 20_000;
export const MIN_HOOK_TIMEOUT_MS = 1_000;
export const MAX_HOOK_TIMEOUT_MS = 120_000;

export const DEFAULT_HOOK_STDIN_TIMEOUT_MS = 3_000;
export const MIN_HOOK_STDIN_TIMEOUT_MS = 100;
export const MAX_HOOK_STDIN_TIMEOUT_MS = 30_000;

type EnvMap = NodeJS.ProcessEnv | Record<string, string | undefined>;

function parseBoundedMs(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = raw?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function resolveHookTimeoutMs(env: EnvMap = process.env): number {
  return parseBoundedMs(
    env.MEMORIX_HOOK_TIMEOUT_MS,
    DEFAULT_HOOK_TIMEOUT_MS,
    MIN_HOOK_TIMEOUT_MS,
    MAX_HOOK_TIMEOUT_MS,
  );
}

export function resolveHookStdinTimeoutMs(env: EnvMap = process.env): number {
  return parseBoundedMs(
    env.MEMORIX_HOOK_STDIN_TIMEOUT_MS,
    DEFAULT_HOOK_STDIN_TIMEOUT_MS,
    MIN_HOOK_STDIN_TIMEOUT_MS,
    MAX_HOOK_STDIN_TIMEOUT_MS,
  );
}

export function hookObservationRuntimeOptions(projectRoot: string): ObservationRuntimeOptions {
  return {
    skipCorpusLoad: true,
    embeddingWriteMode: 'deferred',
    projectRoot,
  };
}

type HookStdin = NodeJS.ReadableStream & {
  pause?: () => void;
  destroy?: (error?: Error) => void;
  unref?: () => void;
  isTTY?: boolean;
};

/**
 * Read hook JSON from a pipe. Resolves on EOF, stream error, or idle timeout.
 * Always releases the stream so an open stdin cannot keep Node alive.
 */
export async function readHookStdin(stdin: HookStdin, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdin.removeListener('data', onData);
      stdin.removeListener('end', finish);
      stdin.removeListener('error', finish);
      stdin.pause?.();
      if (!stdin.isTTY) {
        stdin.destroy?.();
      } else {
        stdin.unref?.();
      }
      resolve(Buffer.concat(chunks).toString('utf-8').trim());
    };

    const onData = (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    };

    const timer = setTimeout(finish, timeoutMs);
    stdin.on('data', onData);
    stdin.on('end', finish);
    stdin.on('error', finish);
  });
}

export interface HookDeadlineIo {
  write(chunk: string): unknown;
}

export interface HookDeadlineOptions {
  timeoutMs: number;
  run: () => Promise<void>;
  stdout?: HookDeadlineIo;
  stderr?: HookDeadlineIo;
  exit?: (code: number) => void;
}

function writeContinue(stdout: HookDeadlineIo): void {
  try {
    stdout.write(JSON.stringify({ continue: true }));
  } catch {
    // The host already closed the pipe. Exiting is still required.
  }
}

/**
 * Run a hook body under a hard deadline, then force-exit.
 * `withTimeout` cannot abort in-flight fetches; process.exit is the backstop.
 */
export async function runHookWithDeadline(options: HookDeadlineOptions): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const exit = options.exit ?? ((code: number) => { process.exit(code); });

  await new Promise<void>((resolve) => {
    let finished = false;

    const settle = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      if (finished) return;
      try {
        stderr.write(`[memorix] hook timed out after ${options.timeoutMs}ms\n`);
      } catch {
        // stderr may already be closed
      }
      writeContinue(stdout);
      exit(0);
      settle();
    }, options.timeoutMs);

    options.run().then(
      () => {
        if (finished) return;
        exit(0);
        settle();
      },
      (error: unknown) => {
        if (finished) return;
        try {
          const message = error instanceof Error ? error.message : String(error);
          stderr.write(`[memorix] hook failed: ${message}\n`);
        } catch {
          // stderr may already be closed
        }
        writeContinue(stdout);
        exit(0);
        settle();
      },
    );
  });
}
