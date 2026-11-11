import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Codex MCP config adapter.
 * Format: TOML file at ~/.codex/config.toml or .codex/config.toml (project-level)
 *
 * Structure:
 *   [mcp_servers.<name>]
 *   command = "npx"
 *   args = ["-y", "memorix-mcp"]
 *   url = "https://..."   # for HTTP servers
 *
 *   [mcp_servers.<name>.env]
 *   KEY = "value"
 *
 * We implement a lightweight TOML parser (no external deps) sufficient
 * for MCP server config blocks. This avoids adding a TOML dependency.
 */
export class CodexMCPAdapter implements MCPConfigAdapter {
  readonly source = 'codex' as const;

  parse(content: string): MCPServerEntry[] {
    if (!content.trim()) return [];

    const servers: MCPServerEntry[] = [];
    const lines = content.split('\n');

    let currentServer: string | null = null;
    let isEnvBlock = false;
    const serverMap = new Map<
      string,
      { command: string; args: string[]; env: Record<string, string>; url?: string; enabled?: boolean }
    >();

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // Skip comments and empty lines
      if (!line || line.startsWith('#')) continue;

      // Match [mcp_servers.<name>.env]
      const envMatch = line.match(/^\[mcp_servers\.([^.\]]+)\.env\]$/);
      if (envMatch) {
        currentServer = envMatch[1];
        isEnvBlock = true;
        if (!serverMap.has(currentServer)) {
          serverMap.set(currentServer, { command: '', args: [], env: {} });
        }
        continue;
      }

      // Match [mcp_servers.<name>]
      const serverMatch = line.match(/^\[mcp_servers\.([^.\]]+)\]$/);
      if (serverMatch) {
        currentServer = serverMatch[1];
        isEnvBlock = false;
        if (!serverMap.has(currentServer)) {
          serverMap.set(currentServer, { command: '', args: [], env: {} });
        }
        continue;
      }

      // Any other section header resets context
      if (line.startsWith('[')) {
        currentServer = null;
        isEnvBlock = false;
        continue;
      }

      // Parse key = value within current server block
      if (currentServer) {
        const kvMatch = line.match(/^(\w+)\s*=\s*(.+)$/);
        if (!kvMatch) continue;

        const key = kvMatch[1];
        const rawValue = kvMatch[2].trim();
        const entry = serverMap.get(currentServer)!;

        if (isEnvBlock) {
          entry.env[key] = this.parseTomlString(rawValue);
        } else if (key === 'command') {
          entry.command = this.parseTomlString(rawValue);
        } else if (key === 'args') {
          entry.args = this.parseTomlArray(rawValue);
        } else if (key === 'url') {
          entry.url = this.parseTomlString(rawValue);
        } else if (key === 'enabled') {
          entry.enabled = rawValue === 'true';
        }
      }
    }

    for (const [name, entry] of serverMap) {
      servers.push({
        name,
        command: entry.command,
        args: entry.args,
        ...(Object.keys(entry.env).length > 0 ? { env: entry.env } : {}),
        ...(entry.url ? { url: entry.url } : {}),
      });
    }

    return servers;
  }

  generate(servers: MCPServerEntry[]): string {
    const blocks: string[] = [];

    for (const s of servers) {
      const lines: string[] = [];
      lines.push(`[mcp_servers.${s.name}]`);

      if (s.url) {
        lines.push(`url = ${this.toTomlString(s.url)}`);
      } else {
        lines.push(`command = ${this.toTomlString(s.command)}`);
        lines.push(`args = [${s.args.map((a) => this.toTomlString(a)).join(', ')}]`);
      }

      if (s.env && Object.keys(s.env).length > 0) {
        lines.push('');
        lines.push(`[mcp_servers.${s.name}.env]`);
        for (const [key, value] of Object.entries(s.env)) {
          lines.push(`${key} = ${this.toTomlString(value)}`);
        }
      }

      blocks.push(lines.join('\n'));
    }

    return blocks.join('\n\n') + '\n';
  }

  getConfigPath(projectRoot?: string): string {
    if (projectRoot) {
      return join(projectRoot, '.codex', 'config.toml');
    }
    return join(homedir(), '.codex', 'config.toml');
  }

  // ---- TOML helpers ----

  private parseTomlString(raw: string): string {
    const trimmed = raw.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  private parseTomlArray(raw: string): string[] {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];
    const inner = trimmed.slice(1, -1);
    const result: string[] = [];
    // Simple CSV parse respecting quotes
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    for (const ch of inner) {
      if (inQuote) {
        if (ch === quoteChar) {
          inQuote = false;
        } else {
          current += ch;
        }
      } else if (ch === '"' || ch === "'") {
        inQuote = true;
        quoteChar = ch;
      } else if (ch === ',') {
        const val = current.trim();
        if (val) result.push(val);
        current = '';
      } else {
        current += ch;
      }
    }
    const last = current.trim();
    if (last) result.push(last);
    return result;
  }

  private toTomlString(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
}
