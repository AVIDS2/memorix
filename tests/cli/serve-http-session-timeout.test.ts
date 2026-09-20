import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';

import { _testing, HttpPayloadTooLargeError, parseJsonBody } from '../../src/cli/commands/serve-http.js';

describe('serve-http session timeout configuration', () => {
  it('keeps HTTP request bodies bounded by default and clamps overrides', () => {
    expect(_testing.parseHttpBodyLimit(undefined)).toBe(10 * 1024 * 1024);
    expect(_testing.parseHttpBodyLimit('1024')).toBe(10 * 1024 * 1024);
    expect(_testing.parseHttpBodyLimit(String(128 * 1024 * 1024))).toBe(64 * 1024 * 1024);
    expect(_testing.parseHttpBodyLimit(String(2 * 1024 * 1024))).toBe(2 * 1024 * 1024);
  });

  it('rejects an oversized streamed JSON body before parsing it', async () => {
    const req = Object.assign(
      Readable.from([Buffer.from(`{"payload":"${'x'.repeat(128 * 1024)}"}`)]),
      { headers: {} },
    ) as any;
    await expect(parseJsonBody(req, 64 * 1024)).rejects.toBeInstanceOf(HttpPayloadTooLargeError);
  });

  it('defaults to 12 hours so ordinary long-lived MCP sessions do not expire mid-task', () => {
    expect(_testing.parseSessionTimeoutMs(undefined)).toBe(12 * 60 * 60 * 1000);
  });

  it('accepts an explicit MEMORIX_SESSION_TIMEOUT_MS value', () => {
    expect(_testing.parseSessionTimeoutMs('86400000')).toBe(24 * 60 * 60 * 1000);
  });

  it('requires an explicit policy before a non-loopback bind', () => {
    expect(_testing.isLoopbackHost('127.0.0.1')).toBe(true);
    expect(_testing.isLoopbackHost('0.0.0.0')).toBe(false);
    expect(() => _testing.validateHttpBindSecurity('0.0.0.0', {})).toThrow(/MEMORIX_HTTP_AUTH_TOKEN/);
    expect(_testing.validateHttpBindSecurity('0.0.0.0', { MEMORIX_HTTP_AUTH_TOKEN: 'secret' })).toEqual({
      requiresAuth: true,
      explicitlyUnauthenticated: false,
    });
    expect(_testing.validateHttpBindSecurity('0.0.0.0', { MEMORIX_HTTP_ALLOW_UNAUTHENTICATED_BIND: '1' })).toEqual({
      requiresAuth: false,
      explicitlyUnauthenticated: true,
    });
  });

  it('allows operators to disable idle session GC, while invalid values keep the default', () => {
    expect(_testing.parseSessionTimeoutMs('0')).toBe(0);
    expect(_testing.parseSessionTimeoutMs('not-a-number')).toBe(12 * 60 * 60 * 1000);
    expect(_testing.parseSessionTimeoutMs('-1')).toBe(12 * 60 * 60 * 1000);
  });
});
