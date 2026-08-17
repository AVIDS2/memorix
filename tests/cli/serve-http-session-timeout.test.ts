import { describe, expect, it } from 'vitest';

import { _testing } from '../../src/cli/commands/serve-http.js';

describe('serve-http session timeout configuration', () => {
  it('defaults to 12 hours so ordinary long-lived MCP sessions do not expire mid-task', () => {
    expect(_testing.parseSessionTimeoutMs(undefined)).toBe(12 * 60 * 60 * 1000);
  });

  it('accepts an explicit MEMORIX_SESSION_TIMEOUT_MS value', () => {
    expect(_testing.parseSessionTimeoutMs('86400000')).toBe(24 * 60 * 60 * 1000);
  });

  it('allows operators to disable idle session GC, while invalid values keep the default', () => {
    expect(_testing.parseSessionTimeoutMs('0')).toBe(0);
    expect(_testing.parseSessionTimeoutMs('not-a-number')).toBe(12 * 60 * 60 * 1000);
    expect(_testing.parseSessionTimeoutMs('-1')).toBe(12 * 60 * 60 * 1000);
  });
});
