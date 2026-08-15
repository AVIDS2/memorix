import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * WorkBuddy MCP config adapter.
 *
 * WorkBuddy keeps its MCP server list in a single user-level JSON file:
 *
 *   ~/.workbuddy/mcp.json
 *
 * The shape follows the standard MCP client convention:
 *
 *   { "mcpServers": { [name]: { command, args, env?, url?, headers? } } }
 *
 * WorkBuddy has no project-level MCP file, so this adapter always targets
 * the user-level path regardless of the optional projectRoot argument.
 */
export class WorkbuddyMCPAdapter implements MCPConfigAdapter {
  readonly source = 'workbuddy' as const;

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
        ...(entry.headers && Object.keys(entry.headers).length > 0 ? { headers: entry.headers } : {}),
        ...(entry.disabled === true ? { disabled: true } : {}),
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
        if (s.headers && Object.keys(s.headers).length > 0) {
          entry.headers = s.headers;
        }
      } else {
        entry.command = s.command;
        entry.args = s.args;
      }
      if (s.env && Object.keys(s.env).length > 0) {
        entry.env = s.env;
      }
      if (s.disabled === true) {
        entry.disabled = true;
      }
      mcpServers[s.name] = entry;
    }
    return JSON.stringify({ mcpServers }, null, 2) + '\n';
  }

  getConfigPath(_projectRoot?: string): string {
    return join(homedir(), '.workbuddy', 'mcp.json');
  }
}
