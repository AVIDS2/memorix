import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml') as {
  load(content: string): unknown;
  dump(value: unknown, options?: Record<string, unknown>): string;
};

export function resolveHermesHome(homeDir?: string): string {
  if (homeDir) return join(homeDir, '.hermes');

  const envHome = process.env.HERMES_HOME?.trim();
  if (envHome) return envHome;

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA?.trim();
    return join(localAppData || join(homedir(), 'AppData', 'Local'), 'hermes');
  }

  return join(homedir(), '.hermes');
}

/**
 * Hermes Agent MCP Configuration Adapter.
 *
 * Hermes stores MCP client servers in HERMES_HOME/config.yaml under `mcp_servers`.
 * Native Windows installs default HERMES_HOME to %LOCALAPPDATA%/hermes.
 * Source: Hermes Agent official MCP docs.
 */
export class HermesMCPAdapter implements MCPConfigAdapter {
  readonly source = 'hermes' as const;

  parse(content: string): MCPServerEntry[] {
    try {
      const config = yaml.load(content) as Record<string, any> | null;
      const servers = config?.mcp_servers ?? {};
      if (!servers || typeof servers !== 'object') return [];

      return Object.entries(servers).map(([name, entry]: [string, any]) => {
        const result: MCPServerEntry = {
          name,
          command: entry.command ?? '',
          args: Array.isArray(entry.args) ? entry.args : [],
        };

        if (entry.url) {
          result.url = entry.url;
        }

        if (entry.headers && typeof entry.headers === 'object' && Object.keys(entry.headers).length > 0) {
          result.headers = entry.headers;
        }

        if (entry.env && typeof entry.env === 'object' && Object.keys(entry.env).length > 0) {
          result.env = entry.env;
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

    return yaml.dump({ mcp_servers: mcpServers }, { lineWidth: -1 });
  }

  getConfigPath(_projectRoot?: string): string {
    return join(resolveHermesHome(), 'config.yaml');
  }
}
