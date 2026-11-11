import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * CodeBuddy Code MCP config adapter.
 * Official locations: project `.mcp.json`, user `~/.codebuddy/.mcp.json`.
 * Plugin setup normally supplies its own `.mcp.json`; this adapter is the
 * explicit config lane for a project or HTTP setup.
 */
export class CodeBuddyMCPAdapter implements MCPConfigAdapter {
  readonly source = 'codebuddy' as const;

  parse(content: string): MCPServerEntry[] {
    try {
      const config = JSON.parse(content) as { mcpServers?: Record<string, any> };
      return Object.entries(config.mcpServers ?? {}).map(([name, entry]) => ({
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
    const mcpServers: Record<string, Record<string, unknown>> = {};
    for (const server of servers) {
      const entry: Record<string, unknown> = server.url
        ? { type: 'http', url: server.url }
        : { type: 'stdio', command: server.command, args: server.args };
      if (server.env && Object.keys(server.env).length > 0) entry.env = server.env;
      mcpServers[server.name] = entry;
    }
    return JSON.stringify({ mcpServers }, null, 2);
  }

  getConfigPath(projectRoot?: string): string {
    return projectRoot ? join(projectRoot, '.mcp.json') : join(homedir(), '.codebuddy', '.mcp.json');
  }
}
