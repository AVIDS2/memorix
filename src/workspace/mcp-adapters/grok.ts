import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CodexMCPAdapter } from './codex.js';

/**
 * Grok Build MCP config adapter.
 * Format: TOML at $GROK_HOME/config.toml (default ~/.grok/config.toml) or
 * .grok/config.toml (project-level). Same `[mcp_servers.<name>]` shape as Codex.
 *
 * Default setup leaves this file host-owned. Explicit `memorix setup --mcp http`
 * writes a URL-only Memorix block.
 */
export class GrokMCPAdapter implements MCPConfigAdapter {
  readonly source = 'grok' as const;
  private readonly toml = new CodexMCPAdapter();

  parse(content: string): MCPServerEntry[] {
    return this.toml.parse(content);
  }

  generate(servers: MCPServerEntry[]): string {
    return this.toml.generate(servers);
  }

  getConfigPath(projectRoot?: string): string {
    if (projectRoot) {
      return join(projectRoot, '.grok', 'config.toml');
    }
    const grokHome = process.env.GROK_HOME?.trim() || join(homedir(), '.grok');
    return join(grokHome, 'config.toml');
  }
}
