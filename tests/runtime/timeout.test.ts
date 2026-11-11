import { describe, expect, it, vi } from 'vitest';
import { withTimeout, withTimeoutSignal } from '../../src/timeout.js';

describe('withTimeout', () => {
  it('clears its watchdog after a successful operation', async () => {
    vi.useFakeTimers();
    try {
      await expect(withTimeout(Promise.resolve('ready'), 1_000, 'test')).resolves.toBe('ready');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears its watchdog after an operation rejects', async () => {
    vi.useFakeTimers();
    try {
      await expect(withTimeout(Promise.reject(new Error('failed')), 1_000, 'test')).rejects.toThrow('failed');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects with the supplied deadline and does not leave a live timer', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const operation = new Promise<void>((resolve) => { finish = resolve; });
    const bounded = withTimeout(operation, 100, 'Search');
    const timeoutExpectation = expect(bounded).rejects.toThrow('Search timed out after 100ms');

    try {
      await vi.advanceTimersByTimeAsync(100);
      await timeoutExpectation;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      finish();
      vi.useRealTimers();
    }
  });
});

describe('withTimeoutSignal', () => {
  it('aborts the operation when the deadline expires', async () => {
    let aborted = false;
    const pending = withTimeoutSignal(
      (signal) => new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(signal.reason);
        }, { once: true });
      }),
      10,
      'Formation pipeline',
    );

    await expect(pending).rejects.toThrow('Formation pipeline timed out after 10ms');
    expect(aborted).toBe(true);
  });

  it('preserves an operation error before the deadline', async () => {
    await expect(withTimeoutSignal(
      async () => { throw new Error('upstream failed'); },
      1_000,
      'Formation pipeline',
    )).rejects.toThrow('upstream failed');
  });

  it('returns at the deadline even when the operation ignores abort', async () => {
    vi.useFakeTimers();
    try {
      const pending = withTimeoutSignal(
        () => new Promise<never>(() => {}),
        100,
        'Embedding',
      );
      const expectation = expect(pending).rejects.toThrow('Embedding timed out after 100ms');
      await vi.advanceTimersByTimeAsync(100);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});
