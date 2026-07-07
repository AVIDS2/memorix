import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Claude Code MCP config adapter.
 * Format: JSON file at ~/.claude.json or project-level .claude/settings.json
 * Structure: { mcpServers: { [name]: { command, args, env?, url? } } }
 */
export class ClaudeCodeMCPAdapter implements MCPConfigAdapter {
  readonly source = 'claude-code' as const;

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
        ...(entry.alwaysLoad === true ? { alwaysLoad: true } : {}),
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
      } else {
        entry.command = s.command;
        entry.args = s.args;
      }
      if (s.env && Object.keys(s.env).length > 0) {
        entry.env = s.env;
      }
      if (s.alwaysLoad === true) {
        entry.alwaysLoad = true;
      }
      mcpServers[s.name] = entry;
    }
    return JSON.stringify({ mcpServers }, null, 2);
  }

  getConfigPath(projectRoot?: string): string {
    if (projectRoot) {
      return join(projectRoot, '.claude', 'settings.json');
    }
    return join(homedir(), '.claude.json');
  }
}
