import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Windsurf MCP config adapter.
 * Format: JSON file at ~/.codeium/windsurf/mcp_config.json
 *
 * Supports two transport modes:
 * 1. stdio:  { command, args, env? }
 * 2. HTTP:   { serverUrl, headers? }
 *
 * Also handles: disabled, disabledTools, env: null
 */
export class WindsurfMCPAdapter implements MCPConfigAdapter {
  readonly source = 'windsurf' as const;

  parse(content: string): MCPServerEntry[] {
    try {
      const config = JSON.parse(content);
      const servers = config.mcpServers ?? config.mcp_servers ?? {};
      return Object.entries(servers).map(([name, entry]: [string, any]) => {
        const result: MCPServerEntry = {
          name,
          command: entry.command ?? '',
          args: entry.args ?? [],
        };

        // HTTP transport: Windsurf uses "serverUrl" (not "url")
        if (entry.serverUrl) {
          result.url = entry.serverUrl;
        } else if (entry.url) {
          result.url = entry.url;
        }

        // Headers (for HTTP transport)
        if (entry.headers && typeof entry.headers === 'object' && Object.keys(entry.headers).length > 0) {
          result.headers = entry.headers;
        }

        // Env (can be null in Windsurf)
        if (entry.env && typeof entry.env === 'object' && Object.keys(entry.env).length > 0) {
          result.env = entry.env;
        }

        // Disabled flag
        if (entry.disabled === true) {
          result.disabled = true;
        }

        return result;
      });
    } catch {
      return [];
    }
  }

  generate(servers: MCPServerEntry[]): string {
    const mcpServers: Record<string, any> = {};
    for (const s of servers) {
      const entry: Record<string, any> = {};

      if (s.url) {
        // HTTP transport — Windsurf uses "serverUrl"
        entry.serverUrl = s.url;
        if (s.headers && Object.keys(s.headers).length > 0) {
          entry.headers = s.headers;
        }
      } else {
        // stdio transport
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
    return JSON.stringify({ mcpServers }, null, 2);
  }

  getConfigPath(_projectRoot?: string): string {
    return join(homedir(), '.codeium', 'windsurf', 'mcp_config.json');
  }
}
