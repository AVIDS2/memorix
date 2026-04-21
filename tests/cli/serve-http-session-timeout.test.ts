import { describe, expect, it } from 'vitest';

import { _testing } from '../../src/cli/commands/serve-http.js';

describe('serve-http session timeout configuration', () => {
  it('defaults to 30 minutes when no env value is provided', () => {
    expect(_testing.parseSessionTimeoutMs(undefined)).toBe(30 * 60 * 1000);
  });

  it('accepts an explicit MEMORIX_SESSION_TIMEOUT_MS value', () => {
    expect(_testing.parseSessionTimeoutMs('86400000')).toBe(24 * 60 * 60 * 1000);
  });

  it('falls back to the default for invalid or non-positive values', () => {
    expect(_testing.parseSessionTimeoutMs('not-a-number')).toBe(30 * 60 * 1000);
    expect(_testing.parseSessionTimeoutMs('0')).toBe(30 * 60 * 1000);
    expect(_testing.parseSessionTimeoutMs('-1')).toBe(30 * 60 * 1000);
  });
});
