import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Kiro MCP config adapter.
 * Format: JSON file at .kiro/settings/mcp.json (project-level)
 *         or ~/.kiro/settings/mcp.json (user-level)
 * Structure: { mcpServers: { ... }, powers?: { mcpServers: { ... } } }
 *
 * Kiro stores user-added servers in `mcpServers` and power-installed
 * servers (context7, figma, postman, supabase etc.) in `powers.mcpServers`.
 * Both sections use the same entry format.
 *
 * Source: Kiro official MCP documentation.
 */
export class KiroMCPAdapter implements MCPConfigAdapter {
    readonly source = 'kiro' as const;

    parse(content: string): MCPServerEntry[] {
        try {
            const config = JSON.parse(content);
            // Merge top-level mcpServers and powers.mcpServers (dedup by name)
            const topLevel = config.mcpServers ?? {};
            const powers = config.powers?.mcpServers ?? {};
            const merged = { ...powers, ...topLevel };
            return Object.entries(merged).map(([name, entry]: [string, any]) => ({
                name,
                command: entry.command ?? '',
                args: entry.args ?? [],
                ...(entry.env && Object.keys(entry.env).length > 0 ? { env: entry.env } : {}),
                ...(entry.url ? { url: entry.url } : {}),
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
            } else {
                entry.command = s.command;
                entry.args = s.args;
            }
            if (s.env && Object.keys(s.env).length > 0) {
                entry.env = s.env;
            }
            mcpServers[s.name] = entry;
        }
        return JSON.stringify({ mcpServers }, null, 2);
    }

    getConfigPath(projectRoot?: string): string {
        if (projectRoot) {
            return join(projectRoot, '.kiro', 'settings', 'mcp.json');
        }
        return join(homedir(), '.kiro', 'settings', 'mcp.json');
    }
}
