import { describe, expect, it } from 'vitest';
import { isBrokenPipeError } from '../../src/cli/pipe-errors.js';

describe('CLI pipe error handling', () => {
  it('recognizes stdout/stderr EPIPE as a normal closed pipe', () => {
    expect(isBrokenPipeError(Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))).toBe(true);
  });

  it('does not swallow unrelated stream errors', () => {
    expect(isBrokenPipeError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(false);
    expect(isBrokenPipeError(new Error('plain'))).toBe(false);
  });
});
