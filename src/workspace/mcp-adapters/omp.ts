import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

const OMP_MCP_SCHEMA = 'https://raw.githubusercontent.com/can1357/oh-my-pi/refs/heads/main/schemas/mcp-schema.json';

/**
 * Oh-my-Pi (omp) MCP Configuration Adapter.
 *
 * OMP native MCP config lives at:
 * - Project: .omp/mcp.json
 * - User:    ~/.omp/agent/mcp.json
 *
 * Format: { "mcpServers": { "name": { command, args, env?, url? } } }
 *
 * Source: Oh-my-Pi official MCP/context docs.
 */
export class OmpMCPAdapter implements MCPConfigAdapter {
  readonly source = 'omp' as const;

  parse(content: string): MCPServerEntry[] {
    try {
      const config = JSON.parse(content);
      const servers = config.mcpServers ?? {};
      const disabledServers = Array.isArray(config.disabledServers)
        ? new Set(config.disabledServers.map(String))
        : new Set<string>();
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

        if (entry.disabled === true || entry.enabled === false || disabledServers.has(name)) {
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
        entry.type = 'http';
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
        entry.enabled = false;
      }

      mcpServers[s.name] = entry;
    }

    return JSON.stringify({ $schema: OMP_MCP_SCHEMA, mcpServers }, null, 2);
  }

  getConfigPath(projectRoot?: string): string {
    if (projectRoot) {
      return join(projectRoot, '.omp', 'mcp.json');
    }
    return join(homedir(), '.omp', 'agent', 'mcp.json');
  }
}
