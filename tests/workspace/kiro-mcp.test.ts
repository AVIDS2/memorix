/**
 * Tests for Kiro MCP Configuration Adapter
 *
 * Covers:
 * - Parsing .kiro/settings/mcp.json format
 * - Generating .kiro/settings/mcp.json format
 * - Config path resolution (project-level vs user-level)
 * - Edge cases (HTTP transport, env, empty config)
 *
 * Based on Kiro official documentation:
 * https://kiro.dev/docs/mcp/
 */

import { describe, it, expect } from 'vitest';
import { KiroMCPAdapter } from '../../src/workspace/mcp-adapters/kiro.js';
import type { MCPServerEntry } from '../../src/types.js';

describe('KiroMCPAdapter', () => {
    const adapter = new KiroMCPAdapter();

    // ============================================================
    // Source
    // ============================================================

    it('should have source "kiro"', () => {
        expect(adapter.source).toBe('kiro');
    });

    // ============================================================
    // Parsing
    // ============================================================

    describe('parse()', () => {
        it('should parse standard mcp.json with stdio servers', () => {
            const config = JSON.stringify({
                mcpServers: {
                    memorix: {
                        command: 'npx',
                        args: ['-y', 'memorix'],
                    },
                    context7: {
                        command: 'npx',
                        args: ['-y', '@upstash/context7-mcp'],
                    },
                },
            });

            const servers = adapter.parse(config);
            expect(servers).toHaveLength(2);

            const memorix = servers.find(s => s.name === 'memorix');
            expect(memorix).toBeDefined();
            expect(memorix!.command).toBe('npx');
            expect(memorix!.args).toEqual(['-y', 'memorix']);

            const context7 = servers.find(s => s.name === 'context7');
            expect(context7).toBeDefined();
            expect(context7!.args).toEqual(['-y', '@upstash/context7-mcp']);
        });

        it('should parse HTTP transport with url', () => {
            const config = JSON.stringify({
                mcpServers: {
                    remote: {
                        url: 'https://api.example.com/mcp',
                    },
                },
            });

            const servers = adapter.parse(config);
            expect(servers).toHaveLength(1);
            expect(servers[0].url).toBe('https://api.example.com/mcp');
        });

        it('should parse env variables', () => {
            const config = JSON.stringify({
                mcpServers: {
                    myserver: {
                        command: 'node',
                        args: ['server.js'],
                        env: { API_KEY: 'secret', NODE_ENV: 'production' },
                    },
                },
            });

            const servers = adapter.parse(config);
            expect(servers[0].env).toEqual({ API_KEY: 'secret', NODE_ENV: 'production' });
        });

        it('should ignore empty env objects', () => {
            const config = JSON.stringify({
                mcpServers: {
                    myserver: {
                        command: 'node',
                        args: [],
                        env: {},
                    },
                },
            });

            const servers = adapter.parse(config);
            expect(servers[0].env).toBeUndefined();
        });

        it('should return empty array for invalid JSON', () => {
            expect(adapter.parse('not valid json')).toEqual([]);
        });

        it('should return empty array for empty mcpServers', () => {
            expect(adapter.parse(JSON.stringify({ mcpServers: {} }))).toEqual([]);
        });

        it('should return empty array for missing mcpServers key', () => {
            expect(adapter.parse(JSON.stringify({}))).toEqual([]);
        });

        it('should handle server with missing command/args gracefully', () => {
            const config = JSON.stringify({
                mcpServers: {
                    minimal: {},
                },
            });

            const servers = adapter.parse(config);
            expect(servers).toHaveLength(1);
            expect(servers[0].name).toBe('minimal');
            expect(servers[0].command).toBe('');
            expect(servers[0].args).toEqual([]);
        });
    });

    // ============================================================
    // Generation
    // ============================================================

    describe('generate()', () => {
        it('should generate valid mcp.json for stdio servers', () => {
            const servers: MCPServerEntry[] = [
                {
                    name: 'memorix',
                    command: 'npx',
                    args: ['-y', 'memorix'],
                },
            ];

            const output = adapter.generate(servers);
            const parsed = JSON.parse(output);

            expect(parsed.mcpServers).toBeDefined();
            expect(parsed.mcpServers.memorix).toBeDefined();
            expect(parsed.mcpServers.memorix.command).toBe('npx');
            expect(parsed.mcpServers.memorix.args).toEqual(['-y', 'memorix']);
        });

        it('should generate valid mcp.json for HTTP transport', () => {
            const servers: MCPServerEntry[] = [
                {
                    name: 'remote',
                    command: '',
                    args: [],
                    url: 'https://api.example.com/mcp',
                },
            ];

            const output = adapter.generate(servers);
            const parsed = JSON.parse(output);

            expect(parsed.mcpServers.remote.url).toBe('https://api.example.com/mcp');
            // HTTP transport should not have command/args
            expect(parsed.mcpServers.remote.command).toBeUndefined();
        });

        it('should include env when present', () => {
            const servers: MCPServerEntry[] = [
                {
                    name: 'server',
                    command: 'node',
                    args: ['index.js'],
                    env: { TOKEN: 'abc' },
                },
            ];

            const output = adapter.generate(servers);
            const parsed = JSON.parse(output);
            expect(parsed.mcpServers.server.env).toEqual({ TOKEN: 'abc' });
        });

        it('should omit empty env', () => {
            const servers: MCPServerEntry[] = [
                {
                    name: 'server',
                    command: 'node',
                    args: [],
                    env: {},
                },
            ];

            const output = adapter.generate(servers);
            const parsed = JSON.parse(output);
            expect(parsed.mcpServers.server.env).toBeUndefined();
        });

        it('should handle multiple servers', () => {
            const servers: MCPServerEntry[] = [
                { name: 'a', command: 'cmd1', args: ['--a'] },
                { name: 'b', command: 'cmd2', args: ['--b'] },
            ];

            const output = adapter.generate(servers);
            const parsed = JSON.parse(output);
            expect(Object.keys(parsed.mcpServers)).toHaveLength(2);
        });

        it('should generate empty mcpServers for empty input', () => {
            const output = adapter.generate([]);
            const parsed = JSON.parse(output);
            expect(parsed.mcpServers).toEqual({});
        });
    });

    // ============================================================
    // Config path
    // ============================================================

    describe('getConfigPath()', () => {
        it('should return project-level path when projectRoot given', () => {
            const configPath = adapter.getConfigPath('/my/project');
            expect(configPath).toContain('.kiro');
            expect(configPath).toContain('settings');
            expect(configPath).toContain('mcp.json');
            expect(configPath).toContain('my');
        });

        it('should return user-level path when no projectRoot', () => {
            const configPath = adapter.getConfigPath();
            expect(configPath).toContain('.kiro');
            expect(configPath).toContain('settings');
            expect(configPath).toContain('mcp.json');
        });
    });

    // ============================================================
    // Round-trip (parse → generate → parse)
    // ============================================================

    describe('round-trip', () => {
        it('should survive parse → generate → parse round-trip', () => {
            const original = JSON.stringify({
                mcpServers: {
                    memorix: {
                        command: 'npx',
                        args: ['-y', 'memorix'],
                        env: { DEBUG: 'true' },
                    },
                    context7: {
                        command: 'npx',
                        args: ['-y', '@upstash/context7-mcp'],
                    },
                },
            });

            const servers = adapter.parse(original);
            const generated = adapter.generate(servers);
            const reparsed = adapter.parse(generated);

            expect(reparsed).toHaveLength(servers.length);
            for (let i = 0; i < servers.length; i++) {
                expect(reparsed[i].name).toBe(servers[i].name);
                expect(reparsed[i].command).toBe(servers[i].command);
                expect(reparsed[i].args).toEqual(servers[i].args);
            }
        });
    });
});
