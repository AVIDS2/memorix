import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * OpenCode MCP Configuration Adapter.
 *
 * OpenCode uses JSON config files for MCP servers:
 * 1. Project-level: opencode.json in project root
 * 2. Global: ~/.config/opencode/opencode.json
 *
 * Format:
 *   {
 *     "$schema": "https://opencode.ai/config.json",
 *     "mcp": {
 *       "name": {
 *         "type": "local",
 *         "command": ["memorix", "serve"],
 *         "environment": { "KEY": "value" },
 *         "enabled": true
 *       }
 *     }
 *   }
 *
 * Remote (HTTP) servers:
 *   {
 *     "mcp": {
 *       "name": {
 *         "type": "remote",
 *         "url": "https://...",
 *         "headers": { "Authorization": "Bearer ..." }
 *       }
 *     }
 *   }
 *
 * Source: https://opencode.ai/docs/mcp-servers/
 */
export class OpenCodeMCPAdapter implements MCPConfigAdapter {
  readonly source = 'opencode' as const;

  parse(content: string): MCPServerEntry[] {
    try {
      const config = JSON.parse(content);
      const servers = config.mcp ?? {};
      return Object.entries(servers).map(([name, entry]: [string, any]) => {
        const result: MCPServerEntry = {
          name,
          command: '',
          args: [],
        };

        if (entry.type === 'remote' && entry.url) {
          // HTTP transport
          result.url = entry.url;
          if (entry.headers && typeof entry.headers === 'object' && Object.keys(entry.headers).length > 0) {
            result.headers = entry.headers;
          }
        } else {
          // Local (stdio) transport — command is an array in OpenCode
          if (Array.isArray(entry.command) && entry.command.length > 0) {
            result.command = entry.command[0];
            result.args = entry.command.slice(1);
          } else if (typeof entry.command === 'string') {
            result.command = entry.command;
          }
        }

        // Environment variables (OpenCode uses "environment" not "env")
        const env = entry.environment ?? entry.env;
        if (env && typeof env === 'object' && Object.keys(env).length > 0) {
          result.env = env;
        }

        // Disabled flag
        if (entry.enabled === false) {
          result.disabled = true;
        }

        return result;
      });
    } catch {
      return [];
    }
  }

  generate(servers: MCPServerEntry[]): string {
    const mcp: Record<string, any> = {};
    for (const s of servers) {
      const entry: Record<string, any> = {};

      if (s.url) {
        // HTTP transport
        entry.type = 'remote';
        entry.url = s.url;
        if (s.headers && Object.keys(s.headers).length > 0) {
          entry.headers = s.headers;
        }
      } else {
        // stdio transport — OpenCode uses command as array
        entry.type = 'local';
        entry.command = [s.command, ...s.args];
      }

      if (s.env && Object.keys(s.env).length > 0) {
        entry.environment = s.env;
      }

      if (s.disabled === true) {
        entry.enabled = false;
      }

      mcp[s.name] = entry;
    }
    return JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp }, null, 2);
  }

  getConfigPath(projectRoot?: string): string {
    if (projectRoot) {
      return join(projectRoot, 'opencode.json');
    }
    return join(homedir(), '.config', 'opencode', 'opencode.json');
  }
}
