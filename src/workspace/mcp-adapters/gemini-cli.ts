import type { MCPConfigAdapter, MCPServerEntry } from '../../types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Gemini CLI MCP Configuration Adapter.
 *
 * Gemini CLI is Google's standalone command-line AI agent (the `gemini` command).
 * It shares the same JSON config format as Antigravity but is a distinct product:
 *
 * - Antigravity = Google's AI-native IDE (VS Code fork)
 * - Gemini CLI  = standalone CLI tool (`gemini` command)
 *
 * Config files:
 * - Project-level: .gemini/settings.json
 * - Global:        ~/.gemini/settings.json
 *
 * Format: { "mcpServers": { "name": { command, args, env? } } }
 *
 * Unlike Antigravity, Gemini CLI does NOT use ~/.gemini/antigravity/mcp_config.json.
 *
 * Source: https://googlegemini.wiki/gemini-cli/configuration
 */
export class GeminiCLIMCPAdapter implements MCPConfigAdapter {
    readonly source = 'gemini-cli' as const;

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
            // Project-level: .gemini/settings.json
            return join(projectRoot, '.gemini', 'settings.json');
        }
        // Global: ~/.gemini/settings.json
        return join(homedir(), '.gemini', 'settings.json');
    }
}
