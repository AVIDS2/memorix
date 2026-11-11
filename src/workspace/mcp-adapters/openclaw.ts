import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * OpenClaw MCP Configuration Adapter.
 *
 * OpenClaw stores MCP client servers in ~/.openclaw/openclaw.json under:
 *   { "mcp": { "servers": { "name": { command, args, env?, url?, transport? } } } }
 *
 * Source: OpenClaw official MCP command docs.
 */
export class OpenClawMCPAdapter implements MCPConfigAdapter {
  readonly source = 'openclaw' as const;

  parse(content: string): MCPServerEntry[] {
    try {
      const config = JSON.parse(content);
      const servers = config.mcp?.servers ?? {};
      if (!servers || typeof servers !== 'object') return [];

      return Object.entries(servers).map(([name, entry]: [string, any]) => {
        const result: MCPServerEntry = {
          name,
          command: entry.command ?? '',
          args: Array.isArray(entry.args) ? entry.args : [],
        };

        if (entry.url) {
          result.url = entry.url;
        } else if (entry.serverUrl) {
          result.url = entry.serverUrl;
        }

        if (entry.headers && typeof entry.headers === 'object' && Object.keys(entry.headers).length > 0) {
          result.headers = entry.headers;
        }

        const env = entry.env ?? entry.environment;
        if (env && typeof env === 'object' && Object.keys(env).length > 0) {
          result.env = env;
        }

        if (entry.disabled === true || entry.enabled === false) {
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
        entry.url = s.url;
        entry.transport = 'streamable-http';
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

    return JSON.stringify({ mcp: { servers: mcpServers } }, null, 2);
  }

  getConfigPath(_projectRoot?: string): string {
    return join(homedir(), '.openclaw', 'openclaw.json');
  }
}
