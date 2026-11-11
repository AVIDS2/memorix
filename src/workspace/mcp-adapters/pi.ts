import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Native Pi MCP configuration (Pi 1.0+).
 * Project: .pi/mcp.json; user: ~/.pi/agent/mcp.json.
 * The extension/skills package is installed separately through `pi install`.
 * https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/mcp.md
 */
export class PiMCPAdapter implements MCPConfigAdapter {
  readonly source = 'pi' as const;

  parse(content: string): MCPServerEntry[] {
    try {
      const config = JSON.parse(content);
      const servers = config.mcpServers;
      if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];

      return Object.entries(servers).flatMap(([name, entry]: [string, any]) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        return [{
          name,
          command: entry.command ?? '',
          args: Array.isArray(entry.args) ? entry.args : [],
          ...(entry.env && Object.keys(entry.env).length > 0 ? { env: entry.env } : {}),
          ...(entry.url ? { url: entry.url } : {}),
          ...(entry.headers && Object.keys(entry.headers).length > 0 ? { headers: entry.headers } : {}),
          ...(entry.enabled === false ? { disabled: true } : {}),
        }];
      });
    } catch {
      return [];
    }
  }

  generate(servers: MCPServerEntry[]): string {
    const mcpServers: Record<string, unknown> = {};
    for (const server of servers) {
      const entry: Record<string, unknown> = server.url
        ? { url: server.url }
        : { command: server.command, args: server.args };
      if (server.url && server.headers && Object.keys(server.headers).length > 0) {
        entry.headers = server.headers;
      }
      if (server.env && Object.keys(server.env).length > 0) entry.env = server.env;
      if (server.disabled === true) entry.enabled = false;
      mcpServers[server.name] = entry;
    }
    return JSON.stringify({ mcpServers }, null, 2) + '\n';
  }

  getConfigPath(projectRoot?: string): string {
    return projectRoot
      ? join(projectRoot, '.pi', 'mcp.json')
      : join(homedir(), '.pi', 'agent', 'mcp.json');
  }
}
