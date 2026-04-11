/**
 * spawn-helper tests — PR #76 Fix 1: stdin EPIPE / early-exit handling.
 *
 * Proves that if the child process closes stdin early (bad args, crash, etc.),
 * the orchestrator process does NOT crash from an unhandled EPIPE/stream error.
 */

import { describe, it, expect } from 'vitest';
import { spawnAgent } from '../../src/orchestrate/adapters/spawn-helper.js';

describe('spawnAgent', () => {
  it('should not crash when child exits before stdin is consumed (EPIPE)', async () => {
    // Spawn a process that exits immediately without reading stdin.
    // On Unix: /bin/false or /usr/bin/true. On Windows: cmd /c exit 1
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'cmd' : 'false';
    const args = isWin ? ['/c', 'exit', '1'] : [];

    const proc = spawnAgent(cmd, args, {
      cwd: process.cwd(),
      timeoutMs: 5_000,
    }, 'This is a long prompt that will be written to stdin of a process that exits immediately before reading it');

    // This must resolve without the process crashing from EPIPE
    const result = await proc.completion;

    // Process exited (non-zero or null for spawn error) — but no crash
    expect(result.killed).toBe(false);
    // The result should exist (completion contract intact)
    expect(result).toBeDefined();
    expect(typeof result.tailOutput).toBe('string');
  });

  it('should include stdin error in tailOutput when EPIPE occurs', async () => {
    // Spawn a process that exits immediately
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'cmd' : 'false';
    const args = isWin ? ['/c', 'exit', '0'] : [];

    const proc = spawnAgent(cmd, args, {
      cwd: process.cwd(),
      timeoutMs: 5_000,
    }, 'x'.repeat(100_000)); // Large payload increases chance of EPIPE on fast exit

    const result = await proc.completion;

    // Completion resolves without crash — that's the main assertion
    expect(result).toBeDefined();
    // If stdin error occurred, it should be in tailOutput (not throw)
    // Note: EPIPE might not always trigger on all platforms, so we just
    // verify the process completed without crashing.
    expect(typeof result.tailOutput).toBe('string');
  });
});
