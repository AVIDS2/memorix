import { describe, expect, it } from 'vitest';
import { resolveServeHttpDefaults } from '../../src/cli/commands/serve-http.js';

/**
 * Server-config exam: the documented [server] section must actually drive
 * startup defaults — a displayed port that never starts a listener is a
 * config lie. Explicit CLI flags always win. Deterministic, offline.
 */

describe('server config defaults exam', () => {
  it('falls back to 3211 when nothing is configured', () => {
    expect(resolveServeHttpDefaults(undefined, {})).toEqual({ port: 3211, transportNotice: undefined });
  });

  it('uses the configured [server].port when the CLI flag is absent', () => {
    expect(resolveServeHttpDefaults(undefined, { port: 4211 })).toEqual({ port: 4211, transportNotice: undefined });
  });

  it('lets the explicit CLI flag beat the configured port', () => {
    expect(resolveServeHttpDefaults('5432', { port: 4211 })).toEqual({ port: 5432, transportNotice: undefined });
  });

  it('notes when config asks for stdio transport', () => {
    const result = resolveServeHttpDefaults(undefined, { transport: 'stdio' });
    expect(result.port).toBe(3211);
    expect(result.transportNotice).toContain('server.transport');
  });

  it('tolerates a configured dashboard flag without affecting the HTTP port', () => {
    expect(resolveServeHttpDefaults(undefined, { dashboard: true, dashboardPort: 3222 })).toEqual({
      port: 3211,
      transportNotice: undefined,
    });
  });
});
