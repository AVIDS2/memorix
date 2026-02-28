import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Antigravity IDE MCP Configuration Adapter.
 *
 * Antigravity uses two JSON config files for MCP servers:
 * 1. Global MCP: ~/.gemini/antigravity/mcp_config.json
 *    Format: { "mcpServers": { "name": { command, args, env? } } }
 *
 * 2. Global settings: ~/.gemini/settings.json
 *    Format: { "mcpServers": { "name": { command, args, env? } } }
 *
 * The mcp_config.json format is the primary config, same JSON structure
 * as Windsurf but at a different path. Also supports HTTP transport via url.
 *
 * Source: Antigravity official documentation (https://antigravity.google/docs/agent/mcp)
 * Verified on local machine: C:\Users\<USER>\.gemini\antigravity\mcp_config.json
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
                entry.url = s.url;
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
            // Project-level: .gemini/settings.json (shared with hooks)
            return join(projectRoot, '.gemini', 'settings.json');
        }
        // Global: ~/.gemini/settings.json
        return join(homedir(), '.gemini', 'settings.json');
    }
}
