import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { HermesMCPAdapter, resolveHermesHome } from '../../src/workspace/mcp-adapters/hermes.js';
import type { MCPServerEntry } from '../../src/types.js';

describe('HermesMCPAdapter', () => {
  const adapter = new HermesMCPAdapter();

  it('uses the hermes source id', () => {
    expect(adapter.source).toBe('hermes');
  });

  it('parses Hermes mcp_servers YAML config', () => {
    const servers = adapter.parse([
      'mcp_servers:',
      '  memorix:',
      '    command: memorix',
      '    args:',
      '      - serve',
      '    env:',
      '      MEMORIX_MODE: full',
      '  remote:',
      '    url: https://example.test/mcp',
      '    headers:',
      '      Authorization: Bearer token',
      '    enabled: false',
      '',
    ].join('\n'));

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

  it('generates Hermes mcp_servers YAML', () => {
    const servers: MCPServerEntry[] = [
      { name: 'memorix', command: 'memorix', args: ['serve'] },
      {
        name: 'remote',
        command: '',
        args: [],
        url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer token' },
        disabled: true,
      },
    ];

    const output = adapter.generate(servers);
    const reparsed = adapter.parse(output);
    expect(output).toContain('mcp_servers:');
    expect(output).toContain('memorix:');
    expect(output).toContain('command: memorix');
    expect(output).toContain('enabled: false');
    expect(reparsed.find((server) => server.name === 'remote')).toMatchObject({
      url: 'https://example.test/mcp',
      disabled: true,
    });
  });

  it('uses the Hermes user config path', () => {
    expect(adapter.getConfigPath().endsWith('config.yaml')).toBe(true);
  });

  it('honors HERMES_HOME before the platform default', () => {
    const previous = process.env.HERMES_HOME;
    const hermesHome = join(process.cwd(), '.tmp-hermes-home');

    try {
      process.env.HERMES_HOME = hermesHome;
      expect(resolveHermesHome()).toBe(hermesHome);
      expect(adapter.getConfigPath()).toBe(join(hermesHome, 'config.yaml'));
    } finally {
      if (previous === undefined) {
        delete process.env.HERMES_HOME;
      } else {
        process.env.HERMES_HOME = previous;
      }
    }
  });
});
