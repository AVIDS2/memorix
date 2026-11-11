import { describe, expect, it } from 'vitest';
import { shouldDefaultToMcp } from '../../src/cli/default-mode.js';

describe('CLI default mode', () => {
  it('keeps bare memorix interactive for a real terminal', () => {
    expect(shouldDefaultToMcp({ stdinIsTTY: true, stdoutIsTTY: true })).toBe(false);
  });

  it('selects stdio MCP for piped or automated launches', () => {
    expect(shouldDefaultToMcp({ stdinIsTTY: false, stdoutIsTTY: false })).toBe(true);
    expect(shouldDefaultToMcp({ stdinIsTTY: undefined, stdoutIsTTY: undefined })).toBe(true);
    expect(shouldDefaultToMcp({ stdinIsTTY: true, stdoutIsTTY: false })).toBe(true);
  });
});
