import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Cursor MCP config adapter.
 * Format: JSON file at ~/.cursor/mcp.json or .cursor/mcp.json (project-level)
 * Structure: { mcpServers: { [name]: { command, args, env?, url? } } }
 */
export class CursorMCPAdapter implements MCPConfigAdapter {
  readonly source = 'cursor' as const;

  parse(content: string): MCPServerEntry[] {
    try {
      const config = JSON.parse(content);
      const servers = config.mcpServers ?? {};
      return Object.entries(servers).map(([name, entry]: [string, any]) => ({
        name,
        command: entry.command ?? '',
        args: entry.args ?? [],
        ...(entry.env && Object.keys(entry.env).length > 0 ? { env: entry.env } : {}),
        ...(entry.url ? { url: entry.url } : {}),
      }));
    } catch {
      return [];
    }
  }

  generate(servers: MCPServerEntry[]): string {
    const mcpServers: Record<string, any> = {};
    for (const s of servers) {
      const entry: Record<string, any> = {};
      if (s.url) {
        entry.url = s.url;
      } else {
        entry.command = s.command;
        entry.args = s.args;
      }
      if (s.env && Object.keys(s.env).length > 0) {
        entry.env = s.env;
      }
      mcpServers[s.name] = entry;
    }
    return JSON.stringify({ mcpServers }, null, 2);
  }

  getConfigPath(projectRoot?: string): string {
    if (projectRoot) {
      return join(projectRoot, '.cursor', 'mcp.json');
    }
    return join(homedir(), '.cursor', 'mcp.json');
  }
}
