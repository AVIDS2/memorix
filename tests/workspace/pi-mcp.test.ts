import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PiMCPAdapter } from '../../src/workspace/mcp-adapters/pi.js';
import type { MCPServerEntry } from '../../src/types.js';

const adapter = new PiMCPAdapter();

describe('PiMCPAdapter', () => {
  it('uses Pi native project and user config paths', () => {
    expect(adapter.source).toBe('pi');
    expect(adapter.getConfigPath('/project')).toBe(join('/project', '.pi', 'mcp.json'));
    expect(adapter.getConfigPath()).toBe(join(homedir(), '.pi', 'agent', 'mcp.json'));
  });

  it('round-trips stdio, HTTP headers, env, and Pi enabled state', () => {
    const servers: MCPServerEntry[] = [
      { name: 'memorix', command: 'memorix', args: ['serve', '--mode', 'lite'], env: { MEMORIX_MODE: 'lite' } },
      { name: 'remote', command: '', args: [], url: 'https://example.test/mcp', headers: { Authorization: 'Bearer ${TOKEN}' }, disabled: true },
    ];
    const generated = adapter.generate(servers);
    const config = JSON.parse(generated);
    expect(config.mcpServers.memorix).toEqual({
      command: 'memorix', args: ['serve', '--mode', 'lite'], env: { MEMORIX_MODE: 'lite' },
    });
    expect(config.mcpServers.remote).toEqual({
      url: 'https://example.test/mcp', headers: { Authorization: 'Bearer ${TOKEN}' }, enabled: false,
    });
    expect(adapter.parse(generated)).toEqual(servers);
    // Unlike Oh-my-Pi, Pi does not need the OMP schema or disabledServers list.
    expect(config.$schema).toBeUndefined();
    expect(config.disabledServers).toBeUndefined();
  });

  it.each(['invalid JSON', 'null', '{}', '{"mcpServers":[]}', '{"mcpServers":null}'])(
    'handles missing or malformed config: %s', content => {
      expect(adapter.parse(content)).toEqual([]);
    },
  );

  it('ignores malformed rows without dropping valid servers', () => {
    expect(adapter.parse(JSON.stringify({ mcpServers: {
      invalid: null,
      memorix: { command: 'memorix', args: ['serve'], enabled: false },
    } }))).toEqual([{ name: 'memorix', command: 'memorix', args: ['serve'], disabled: true }]);
  });
});
