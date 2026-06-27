import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Antigravity MCP Configuration Adapter.
 *
 * Antigravity 2.0 / IDE / CLI use dedicated MCP config files:
 * - Global:    ~/.gemini/config/mcp_config.json
 * - Workspace: .agents/mcp_config.json
 *
 * Legacy Gemini CLI settings.json and the older
 * ~/.gemini/antigravity/mcp_config.json location are read by workspace
 * scanning for compatibility, but new writes should use the official
 * dedicated mcp_config.json profiles.
 *
 * Source: https://antigravity.google/docs/mcp
 */
export class AntigravityMCPAdapter implements MCPConfigAdapter {
    readonly source = 'antigravity' as const;

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

                // HTTP transport
                if (entry.serverUrl) {
                    result.url = entry.serverUrl;
                } else if (entry.url) {
                    result.url = entry.url;
                }

                // Headers (for HTTP transport)
                if (entry.headers && typeof entry.headers === 'object' && Object.keys(entry.headers).length > 0) {
                    result.headers = entry.headers;
                }

                // Env
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
                // HTTP transport
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

    getConfigPath(projectRoot?: string): string {
        if (projectRoot) {
            // Workspace-level Antigravity MCP profile.
            return join(projectRoot, '.agents', 'mcp_config.json');
        }
        // Global Antigravity MCP profile.
        return join(homedir(), '.gemini', 'config', 'mcp_config.json');
    }
}
