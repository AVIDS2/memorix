import { describe, it, expect } from 'vitest';
import type { MCPServerEntry } from '../../src/types.js';
import { WindsurfMCPAdapter } from '../../src/workspace/mcp-adapters/windsurf.js';
import { CursorMCPAdapter } from '../../src/workspace/mcp-adapters/cursor.js';
import { CodexMCPAdapter } from '../../src/workspace/mcp-adapters/codex.js';
import { ClaudeCodeMCPAdapter } from '../../src/workspace/mcp-adapters/claude-code.js';

// ============================================================
// Test Data
// ============================================================

const sampleServers: MCPServerEntry[] = [
  {
    name: 'memorix',
    command: 'npx',
    args: ['-y', 'memorix-mcp'],
    env: { MEMORIX_PROJECT: 'my-project' },
  },
  {
    name: 'context7',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
  },
  {
    name: 'figma',
    command: '',
    args: [],
    url: 'https://mcp.figma.com/mcp',
    env: { FIGMA_TOKEN: 'abc123' },
  },
];

// ============================================================
// Windsurf adapter tests
// ============================================================

describe('WindsurfMCPAdapter', () => {
  const adapter = new WindsurfMCPAdapter();

  const windsurfConfig = JSON.stringify({
    mcpServers: {
      memorix: {
        command: 'npx',
        args: ['-y', 'memorix-mcp'],
        env: { MEMORIX_PROJECT: 'my-project' },
      },
      context7: {
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp'],
      },
    },
  });

  it('source should be windsurf', () => {
    expect(adapter.source).toBe('windsurf');
  });

  it('parse should extract servers from JSON config', () => {
    const servers = adapter.parse(windsurfConfig);
    expect(servers).toHaveLength(2);
    expect(servers[0].name).toBe('memorix');
    expect(servers[0].command).toBe('npx');
    expect(servers[0].args).toEqual(['-y', 'memorix-mcp']);
    expect(servers[0].env).toEqual({ MEMORIX_PROJECT: 'my-project' });
    expect(servers[1].name).toBe('context7');
  });

  it('parse should handle empty config', () => {
    expect(adapter.parse('{}')).toEqual([]);
    expect(adapter.parse('{"mcpServers": {}}')).toEqual([]);
  });

  it('generate should produce valid Windsurf JSON config', () => {
    const output = adapter.generate(sampleServers.slice(0, 2));
    const parsed = JSON.parse(output);
    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers.memorix.command).toBe('npx');
    expect(parsed.mcpServers.memorix.args).toEqual(['-y', 'memorix-mcp']);
    expect(parsed.mcpServers.context7).toBeDefined();
  });

  it('generate should handle URL-based servers with serverUrl', () => {
    const output = adapter.generate([sampleServers[2]]);
    const parsed = JSON.parse(output);
    expect(parsed.mcpServers.figma.serverUrl).toBe('https://mcp.figma.com/mcp');
  });

  it('parse should handle serverUrl + headers (HTTP transport)', () => {
    const httpConfig = JSON.stringify({
      mcpServers: {
        context7: {
          headers: { CONTEXT7_API_KEY: 'test-key' },
          serverUrl: 'https://mcp.context7.com/mcp',
        },
      },
    });
    const servers = adapter.parse(httpConfig);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('context7');
    expect(servers[0].url).toBe('https://mcp.context7.com/mcp');
    expect(servers[0].headers).toEqual({ CONTEXT7_API_KEY: 'test-key' });
    expect(servers[0].command).toBe('');
  });

  it('parse should handle disabled flag and env: null', () => {
    const config = JSON.stringify({
      mcpServers: {
        memorix: {
          command: 'node',
          args: ['serve'],
          disabled: false,
          env: null,
        },
      },
    });
    const servers = adapter.parse(config);
    expect(servers).toHaveLength(1);
    expect(servers[0].disabled).toBeUndefined();
    expect(servers[0].env).toBeUndefined();
  });

  it('generate should output serverUrl for HTTP servers with headers', () => {
    const server: MCPServerEntry = {
      name: 'context7',
      command: '',
      args: [],
      url: 'https://mcp.context7.com/mcp',
      headers: { CONTEXT7_API_KEY: 'test-key' },
    };
    const output = adapter.generate([server]);
    const parsed = JSON.parse(output);
    expect(parsed.mcpServers.context7.serverUrl).toBe('https://mcp.context7.com/mcp');
    expect(parsed.mcpServers.context7.headers).toEqual({ CONTEXT7_API_KEY: 'test-key' });
    expect(parsed.mcpServers.context7.command).toBeUndefined();
  });
});

// ============================================================
// Cursor adapter tests
// ============================================================

describe('CursorMCPAdapter', () => {
  const adapter = new CursorMCPAdapter();

  const cursorConfig = JSON.stringify({
    mcpServers: {
      memorix: {
        command: 'npx',
        args: ['-y', 'memorix-mcp'],
        env: { MEMORIX_PROJECT: 'my-project' },
      },
    },
  });

  it('source should be cursor', () => {
    expect(adapter.source).toBe('cursor');
  });

  it('parse should extract servers', () => {
    const servers = adapter.parse(cursorConfig);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('memorix');
  });

  it('generate should produce valid Cursor JSON config', () => {
    const output = adapter.generate(sampleServers.slice(0, 1));
    const parsed = JSON.parse(output);
    expect(parsed.mcpServers.memorix).toBeDefined();
  });
});

// ============================================================
// Codex adapter tests (TOML format)
// ============================================================

describe('CodexMCPAdapter', () => {
  const adapter = new CodexMCPAdapter();

  const codexConfig = `
[mcp_servers.memorix]
command = "npx"
args = ["-y", "memorix-mcp"]

[mcp_servers.memorix.env]
MEMORIX_PROJECT = "my-project"

[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]

[mcp_servers.figma]
url = "https://mcp.figma.com/mcp"
`;

  it('source should be codex', () => {
    expect(adapter.source).toBe('codex');
  });

  it('parse should extract servers from TOML config', () => {
    const servers = adapter.parse(codexConfig);
    expect(servers.length).toBeGreaterThanOrEqual(2);
    const memorix = servers.find((s: MCPServerEntry) => s.name === 'memorix');
    expect(memorix).toBeDefined();
    expect(memorix!.command).toBe('npx');
    expect(memorix!.args).toEqual(['-y', 'memorix-mcp']);
    expect(memorix!.env).toEqual({ MEMORIX_PROJECT: 'my-project' });
  });

  it('parse should handle URL-based servers', () => {
    const servers = adapter.parse(codexConfig);
    const figma = servers.find((s: MCPServerEntry) => s.name === 'figma');
    expect(figma).toBeDefined();
    expect(figma!.url).toBe('https://mcp.figma.com/mcp');
  });

  it('parse should handle empty TOML', () => {
    expect(adapter.parse('')).toEqual([]);
  });

  it('generate should produce valid TOML config', () => {
    const output = adapter.generate(sampleServers.slice(0, 2));
    expect(output).toContain('[mcp_servers.memorix]');
    expect(output).toContain('command = "npx"');
    expect(output).toContain('args = ["-y", "memorix-mcp"]');
    expect(output).toContain('[mcp_servers.context7]');
  });

  it('generate should handle URL-based servers', () => {
    const output = adapter.generate([sampleServers[2]]);
    expect(output).toContain('[mcp_servers.figma]');
    expect(output).toContain('url = "https://mcp.figma.com/mcp"');
  });
});

// ============================================================
// Claude Code adapter tests
// ============================================================

describe('ClaudeCodeMCPAdapter', () => {
  const adapter = new ClaudeCodeMCPAdapter();

  const claudeConfig = JSON.stringify({
    mcpServers: {
      memorix: {
        command: 'npx',
        args: ['-y', 'memorix-mcp'],
        env: { MEMORIX_PROJECT: 'my-project' },
        alwaysLoad: true,
      },
    },
  });

  it('source should be claude-code', () => {
    expect(adapter.source).toBe('claude-code');
  });

  it('parse should extract servers', () => {
    const servers = adapter.parse(claudeConfig);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('memorix');
    expect(servers[0].alwaysLoad).toBe(true);
  });

  it('generate should produce valid config', () => {
    const output = adapter.generate([{ ...sampleServers[0], alwaysLoad: true }]);
    const parsed = JSON.parse(output);
    expect(parsed.mcpServers.memorix).toBeDefined();
    expect(parsed.mcpServers.memorix.alwaysLoad).toBe(true);
  });
});

// ============================================================
// Real-world config tests (from user's actual setup)
// ============================================================

describe('Real-world Windsurf config', () => {
  const adapter = new WindsurfMCPAdapter();

  const realConfig = JSON.stringify({
    mcpServers: {
      context7: {
        headers: { CONTEXT7_API_KEY: 'ctx7sk-xxx' },
        serverUrl: 'https://mcp.context7.com/mcp',
      },
      'figma-remote-mcp-server': {
        args: ['-y', 'mcp-remote', 'https://mcp.figma.com/mcp'],
        command: 'npx',
      },
      memorix: {
        args: ['E:/my_idea_cc/my_copilot/memorix/dist/cli/index.js', 'serve'],
        command: 'node',
        disabled: false,
        env: null,
      },
      playwright: {
        args: ['@playwright/mcp@latest'],
        command: 'npx',
      },
    },
  });

  it('should parse all 4 real servers', () => {
    const servers = adapter.parse(realConfig);
    expect(servers).toHaveLength(4);
  });

  it('should parse context7 as HTTP transport with headers', () => {
    const servers = adapter.parse(realConfig);
    const ctx7 = servers.find((s: MCPServerEntry) => s.name === 'context7')!;
    expect(ctx7.url).toBe('https://mcp.context7.com/mcp');
    expect(ctx7.headers).toEqual({ CONTEXT7_API_KEY: 'ctx7sk-xxx' });
  });

  it('should parse memorix as stdio with env:null handled', () => {
    const servers = adapter.parse(realConfig);
    const mx = servers.find((s: MCPServerEntry) => s.name === 'memorix')!;
    expect(mx.command).toBe('node');
    expect(mx.env).toBeUndefined();
  });
});

describe('Real-world Codex config', () => {
  const adapter = new CodexMCPAdapter();

  const realConfig = `
model = "gpt-5.3-codex"
model_reasoning_effort = "high"

[mcp_servers.playwright]
args = [ "@playwright/mcp@latest" ]
command = "npx"

[mcp_servers.context7]
args = [ "-y", "@upstash/context7-mcp", "--api-key", "ctx7sk-xxx" ]
command = "npx"
enabled = true

[mcp_servers.figma]
url = "https://mcp.figma.com/mcp"

[mcp_servers.memorix]
command = "node"
args = ["E:/my_idea_cc/my_copilot/memorix/dist/cli/index.js", "serve"]
`;

  it('should parse all 4 real servers', () => {
    const servers = adapter.parse(realConfig);
    expect(servers).toHaveLength(4);
  });

  it('should parse context7 with 4 args', () => {
    const servers = adapter.parse(realConfig);
    const ctx7 = servers.find((s: MCPServerEntry) => s.name === 'context7')!;
    expect(ctx7.command).toBe('npx');
    expect(ctx7.args).toEqual(['-y', '@upstash/context7-mcp', '--api-key', 'ctx7sk-xxx']);
  });

  it('should parse figma as URL-only server', () => {
    const servers = adapter.parse(realConfig);
    const figma = servers.find((s: MCPServerEntry) => s.name === 'figma')!;
    expect(figma.url).toBe('https://mcp.figma.com/mcp');
    expect(figma.command).toBe('');
  });

  it('should ignore non-mcp_servers sections (model, skills)', () => {
    const servers = adapter.parse(realConfig);
    const names = servers.map((s: MCPServerEntry) => s.name);
    expect(names).not.toContain('config');
    expect(names).toContain('memorix');
  });
});

// ============================================================
// Cross-agent round-trip tests
// ============================================================

describe('Cross-agent MCP config conversion', () => {
  const windsurf = new WindsurfMCPAdapter();
  const cursor = new CursorMCPAdapter();
  const codex = new CodexMCPAdapter();
  const claude = new ClaudeCodeMCPAdapter();

  it('Windsurf → Codex round-trip preserves stdio servers', () => {
    const wsConfig = windsurf.generate(sampleServers.slice(0, 2));
    const servers = windsurf.parse(wsConfig);
    const codexConfig = codex.generate(servers);
    const recovered = codex.parse(codexConfig);
    expect(recovered).toHaveLength(2);
    expect(recovered[0].name).toBe('memorix');
    expect(recovered[0].command).toBe('npx');
    expect(recovered[0].env).toEqual({ MEMORIX_PROJECT: 'my-project' });
  });

  it('Windsurf HTTP → Codex URL round-trip', () => {
    const httpServer: MCPServerEntry = {
      name: 'context7',
      command: '',
      args: [],
      url: 'https://mcp.context7.com/mcp',
      headers: { API_KEY: 'test' },
    };
    const wsConfig = windsurf.generate([httpServer]);
    const parsed = windsurf.parse(wsConfig);
    expect(parsed[0].url).toBe('https://mcp.context7.com/mcp');

    // Codex uses `url` field (no headers support in TOML)
    const codexConfig = codex.generate(parsed);
    const recovered = codex.parse(codexConfig);
    expect(recovered[0].url).toBe('https://mcp.context7.com/mcp');
  });

  it('Codex → Cursor round-trip preserves server data', () => {
    const codexOut = codex.generate(sampleServers.slice(0, 2));
    const servers = codex.parse(codexOut);
    const cursorConfig = cursor.generate(servers);
    const recovered = cursor.parse(cursorConfig);
    expect(recovered).toHaveLength(2);
    expect(recovered[0].name).toBe('memorix');
  });

  it('Windsurf → Claude Code round-trip preserves server data', () => {
    const wsConfig = windsurf.generate(sampleServers.slice(0, 2));
    const servers = windsurf.parse(wsConfig);
    const claudeConfig = claude.generate(servers);
    const recovered = claude.parse(claudeConfig);
    expect(recovered).toHaveLength(2);
    expect(recovered[1].name).toBe('context7');
  });
});
