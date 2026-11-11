import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Trae IDE MCP Configuration Adapter.
 *
 * Trae stores MCP config at the user level:
 *   %APPDATA%/Trae/User/mcp.json  (Windows)
 *   ~/Library/Application Support/Trae/User/mcp.json  (macOS)
 *   ~/.config/Trae/User/mcp.json  (Linux)
 *
 * Format (OBJECT-keyed, same as Cursor):
 *   {
 *     "mcpServers": {
 *       "memorix": {
 *         "command": "memorix",
 *         "args": ["serve"],
 *         "env": { "KEY": "value" }
 *       }
 *     }
 *   }
 *
 * SSE transport:
 *   {
 *     "mcpServers": {
 *       "remote": {
 *         "url": "https://...",
 *         "type": "sse"
 *       }
 *     }
 *   }
 *
 * Source: https://docs.trae.ai/ide/model-context-protocol
 */
export class TraeMCPAdapter implements MCPConfigAdapter {
  readonly source = 'trae' as const;

  parse(content: string): MCPServerEntry[] {
    try {
      const config = JSON.parse(content);
      const servers = config.mcpServers;

      if (!servers || typeof servers !== 'object') return [];

      // Object-keyed format: { "mcpServers": { "name": { ... } } }
      return Object.entries(servers).map(([name, entry]: [string, any]) => {
        const result: MCPServerEntry = {
          name,
          command: '',
          args: [],
        };

        if (typeof entry.command === 'string') {
          result.command = entry.command;
        }

        if (Array.isArray(entry.args)) {
          result.args = entry.args;
        }

        // SSE/HTTP transport
        if (entry.url) {
          result.url = entry.url;
        }

        // Environment variables
        if (entry.env && typeof entry.env === 'object' && Object.keys(entry.env).length > 0) {
          result.env = entry.env;
        }

        // Headers (for HTTP transport)
        if (entry.headers && typeof entry.headers === 'object' && Object.keys(entry.headers).length > 0) {
          result.headers = entry.headers;
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
        // SSE/HTTP transport
        entry.url = s.url;
        if (s.headers && Object.keys(s.headers).length > 0) {
          entry.headers = s.headers;
        }
      } else {
        // stdio transport
        entry.command = s.command;
        if (s.args && s.args.length > 0) {
          entry.args = s.args;
        }
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
    const home = homedir();
    // Trae stores user-level MCP config in AppData (Windows) / Application Support (macOS) / .config (Linux)
    if (process.platform === 'win32') {
      return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Trae', 'User', 'mcp.json');
    }
    if (process.platform === 'darwin') {
      return join(home, 'Library', 'Application Support', 'Trae', 'User', 'mcp.json');
    }
    return join(home, '.config', 'Trae', 'User', 'mcp.json');
  }
}
