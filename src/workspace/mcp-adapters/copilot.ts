import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * VS Code Copilot MCP config adapter.
 *
 * Supports two config locations / formats:
 *
 * 1. Workspace-level (preferred, new):
 *    Path: .vscode/mcp.json
 *    Format: { "servers": { [name]: { command, args, env?, url? } } }
 *
 * 2. Global (legacy, still scanned):
 *    Path: %APPDATA%/Code/User/settings.json
 *    Format: { "mcp": { "servers": { [name]: { command, args, env? } } } }
 *
 * parse() auto-detects which format is provided.
 * generate() always outputs the new .vscode/mcp.json format.
 * getConfigPath(projectRoot) returns workspace path; getConfigPath() returns global path.
 */
export class CopilotMCPAdapter implements MCPConfigAdapter {
  readonly source = 'copilot' as const;

  parse(content: string): MCPServerEntry[] {
    try {
      const config = JSON.parse(content);

      // Auto-detect format:
      // 1. mcp.json format: { "servers": { ... } }
      // 2. settings.json format: { "mcp": { "servers": { ... } } }
      const servers = config?.servers ?? config?.mcp?.servers ?? {};

      return Object.entries(servers).map(([name, entry]: [string, any]) => {
        const result: MCPServerEntry = {
          name,
          command: entry.command ?? '',
          args: entry.args ?? [],
        };

        if (entry.type) {
          // VS Code mcp.json supports "type" field (e.g., "http", "stdio")
          // Map to url for HTTP types
          if ((entry.type === 'http' || entry.type === 'sse') && entry.url) {
            result.url = entry.url;
          }
        } else if (entry.url) {
          result.url = entry.url;
        }

        if (entry.env && typeof entry.env === 'object' && Object.keys(entry.env).length > 0) {
          result.env = entry.env;
        }

        if (entry.headers && typeof entry.headers === 'object' && Object.keys(entry.headers).length > 0) {
          result.headers = entry.headers;
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
        entry.type = 'http';
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
      mcpServers[s.name] = entry;
    }

    // Output the new .vscode/mcp.json format: { "servers": { ... } }
    return JSON.stringify({ servers: mcpServers }, null, 2);
  }

  getConfigPath(projectRoot?: string): string {
    if (projectRoot) {
      // Workspace-level: .vscode/mcp.json (new official format)
      return join(projectRoot, '.vscode', 'mcp.json');
    }
    // Global: VS Code user settings path (legacy, for scan fallback)
    const home = homedir();
    if (process.platform === 'win32') {
      return join(home, 'AppData', 'Roaming', 'Code', 'User', 'settings.json');
    } else if (process.platform === 'darwin') {
      return join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
    } else {
      return join(home, '.config', 'Code', 'User', 'settings.json');
    }
  }
}
