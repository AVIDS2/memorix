import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_HOOK_TIMEOUT_MS,
  hookObservationRuntimeOptions,
  readHookStdin,
  resolveHookStdinTimeoutMs,
  resolveHookTimeoutMs,
  runHookWithDeadline,
} from '../../src/hooks/lifecycle.js';

describe('hook process lifecycle', () => {
  const originalTimeout = process.env.MEMORIX_HOOK_TIMEOUT_MS;
  const originalStdinTimeout = process.env.MEMORIX_HOOK_STDIN_TIMEOUT_MS;

  afterEach(() => {
    if (originalTimeout === undefined) delete process.env.MEMORIX_HOOK_TIMEOUT_MS;
    else process.env.MEMORIX_HOOK_TIMEOUT_MS = originalTimeout;
    if (originalStdinTimeout === undefined) delete process.env.MEMORIX_HOOK_STDIN_TIMEOUT_MS;
    else process.env.MEMORIX_HOOK_STDIN_TIMEOUT_MS = originalStdinTimeout;
  });

  it('bounds the wall-clock budget and keeps it env-overridable', () => {
    expect(resolveHookTimeoutMs({})).toBe(DEFAULT_HOOK_TIMEOUT_MS);
    expect(DEFAULT_HOOK_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
    expect(DEFAULT_HOOK_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
    expect(resolveHookTimeoutMs({ MEMORIX_HOOK_TIMEOUT_MS: '8000' })).toBe(8_000);
    expect(resolveHookTimeoutMs({ MEMORIX_HOOK_TIMEOUT_MS: 'nope' })).toBe(DEFAULT_HOOK_TIMEOUT_MS);
    expect(resolveHookStdinTimeoutMs({})).toBe(3_000);
    expect(resolveHookStdinTimeoutMs({ MEMORIX_HOOK_STDIN_TIMEOUT_MS: '500' })).toBe(500);
  });

  it('returns stdin on EOF and does not wait for a producer that already finished', async () => {
    const stdin = new PassThrough();
    const pending = readHookStdin(stdin, 5_000);
    stdin.write('{"hook_event_name":"Stop"}');
    stdin.end();
    await expect(pending).resolves.toBe('{"hook_event_name":"Stop"}');
  });

  it('releases a pipe after the idle timeout so the event loop can exit', async () => {
    const stdin = new PassThrough();
    const pause = vi.spyOn(stdin, 'pause');
    const destroy = vi.spyOn(stdin, 'destroy');
    const pending = readHookStdin(stdin, 40);
    stdin.write('{"partial":true}');
    await expect(pending).resolves.toBe('{"partial":true}');
    expect(pause).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });

  it('exits after a successful hook so leftover handles cannot keep Node alive', async () => {
    const exits: number[] = [];
    await runHookWithDeadline({
      timeoutMs: 1_000,
      run: async () => undefined,
      stdout: { write: () => true },
      stderr: { write: () => true },
      exit: (code) => { exits.push(code); },
    });
    expect(exits).toEqual([0]);
  });

  it('writes continue:true and exits when hook work exceeds the deadline', async () => {
    const writes: string[] = [];
    const stderr: string[] = [];
    const exits: number[] = [];
    await runHookWithDeadline({
      timeoutMs: 25,
      run: () => new Promise(() => {}),
      stdout: { write: (chunk) => { writes.push(String(chunk)); return true; } },
      stderr: { write: (chunk) => { stderr.push(String(chunk)); return true; } },
      exit: (code) => { exits.push(code); },
    });
    expect(JSON.parse(writes.join(''))).toMatchObject({ continue: true });
    expect(stderr.join('')).toMatch(/timed out after 25ms/i);
    expect(exits).toEqual([0]);
  });

  it('writes continue:true and exits when hook work throws', async () => {
    const writes: string[] = [];
    const exits: number[] = [];
    await runHookWithDeadline({
      timeoutMs: 1_000,
      run: async () => { throw new Error('store exploded'); },
      stdout: { write: (chunk) => { writes.push(String(chunk)); return true; } },
      stderr: { write: () => true },
      exit: (code) => { exits.push(code); },
    });
    expect(JSON.parse(writes.join(''))).toMatchObject({ continue: true });
    expect(exits).toEqual([0]);
  });

  it('defers hook embeddings so a remote fetch cannot pin the CLI process', () => {
    expect(hookObservationRuntimeOptions('/repo')).toEqual({
      skipCorpusLoad: true,
      embeddingWriteMode: 'deferred',
      projectRoot: '/repo',
    });
  });
});
