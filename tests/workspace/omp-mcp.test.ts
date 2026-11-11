import { describe, expect, it } from 'vitest';
import { OmpMCPAdapter } from '../../src/workspace/mcp-adapters/omp.js';
import type { MCPServerEntry } from '../../src/types.js';

describe('OmpMCPAdapter', () => {
  const adapter = new OmpMCPAdapter();

  it('uses the omp source id', () => {
    expect(adapter.source).toBe('omp');
  });

  it('parses Oh-my-Pi mcpServers config', () => {
    const servers = adapter.parse(JSON.stringify({
      disabledServers: ['remote'],
      mcpServers: {
        memorix: {
          command: 'memorix',
          args: ['serve'],
          env: { MEMORIX_MODE: 'full' },
        },
        remote: {
          url: 'https://example.test/mcp',
          headers: { Authorization: 'Bearer token' },
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

  it('generates Oh-my-Pi config with schema and HTTP type', () => {
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

    const parsed = JSON.parse(adapter.generate(servers));
    expect(parsed.$schema).toContain('mcp-schema.json');
    expect(parsed.mcpServers.memorix).toMatchObject({
      command: 'memorix',
      args: ['serve'],
    });
    expect(parsed.mcpServers.remote).toMatchObject({
      type: 'http',
      url: 'https://example.test/mcp',
      enabled: false,
    });
  });

  it('uses project config before the Oh-my-Pi user config path', () => {
    expect(adapter.getConfigPath('/project')).toContain('.omp');
    expect(adapter.getConfigPath('/project').endsWith('mcp.json')).toBe(true);
    expect(adapter.getConfigPath()).toContain('.omp');
    expect(adapter.getConfigPath().endsWith('mcp.json')).toBe(true);
  });
});
