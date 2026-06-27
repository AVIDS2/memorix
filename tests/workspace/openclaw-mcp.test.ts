import { describe, expect, it } from 'vitest';
import { OpenClawMCPAdapter } from '../../src/workspace/mcp-adapters/openclaw.js';
import type { MCPServerEntry } from '../../src/types.js';

describe('OpenClawMCPAdapter', () => {
  const adapter = new OpenClawMCPAdapter();

  it('uses the openclaw source id', () => {
    expect(adapter.source).toBe('openclaw');
  });

  it('parses OpenClaw mcp.servers config', () => {
    const servers = adapter.parse(JSON.stringify({
      mcp: {
        servers: {
          memorix: {
            command: 'memorix',
            args: ['serve'],
            env: { MEMORIX_MODE: 'full' },
          },
          remote: {
            url: 'https://example.test/mcp',
            headers: { Authorization: 'Bearer token' },
            enabled: false,
          },
        },
      },
    }));

    expect(servers).toHaveLength(2);
    expect(servers[0]).toMatchObject({
      name: 'memorix',
      command: 'memorix',
      args: ['serve'],
      env: { MEMORIX_MODE: 'full' },
    });
    expect(servers[1]).toMatchObject({
      name: 'remote',
      url: 'https://example.test/mcp',
      disabled: true,
    });
  });

  it('generates OpenClaw stdio and streamable HTTP entries', () => {
    const servers: MCPServerEntry[] = [
      { name: 'memorix', command: 'memorix', args: ['serve'] },
      {
        name: 'remote',
        command: '',
        args: [],
        url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer token' },
      },
    ];

    const parsed = JSON.parse(adapter.generate(servers));
    expect(parsed.mcp.servers.memorix).toMatchObject({
      command: 'memorix',
      args: ['serve'],
    });
    expect(parsed.mcp.servers.remote).toMatchObject({
      url: 'https://example.test/mcp',
      transport: 'streamable-http',
      headers: { Authorization: 'Bearer token' },
    });
  });

  it('uses the OpenClaw user config path', () => {
    expect(adapter.getConfigPath()).toContain('.openclaw');
    expect(adapter.getConfigPath().endsWith('openclaw.json')).toBe(true);
  });
});
