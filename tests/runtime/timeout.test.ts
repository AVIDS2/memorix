import { describe, expect, it, vi } from 'vitest';
import { withTimeout } from '../../src/timeout.js';

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
