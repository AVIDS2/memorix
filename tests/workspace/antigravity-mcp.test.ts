/**
 * Tests for Antigravity MCP Configuration Adapter
 *
 * Covers:
 * - Parsing mcp_config.json format
 * - Generating mcp_config.json format
 * - Config path resolution
 * - Edge cases (HTTP transport, env, disabled flags)
 */

import { describe, it, expect } from 'vitest';
import { AntigravityMCPAdapter } from '../../src/workspace/mcp-adapters/antigravity.js';
import type { MCPServerEntry } from '../../src/types.js';

describe('AntigravityMCPAdapter', () => {
    const adapter = new AntigravityMCPAdapter();

    // ============================================================
    // Source
    // ============================================================

    it('should have source "antigravity"', () => {
        expect(adapter.source).toBe('antigravity');
    });

    // ============================================================
    // Parsing
    // ============================================================

    describe('parse()', () => {
        it('should parse standard mcp_config.json', () => {
            const config = JSON.stringify({
                mcpServers: {
                    context7: {
                        command: 'npx',
                        args: ['-y', '@upstash/context7-mcp'],
                    },
                    pencil: {
                        command: '/path/to/mcp-server.exe',
                        args: ['--app', 'antigravity'],
                        env: {},
                    },
                },
            });

            const servers = adapter.parse(config);
            expect(servers).toHaveLength(2);

            const context7 = servers.find(s => s.name === 'context7');
            expect(context7).toBeDefined();
            expect(context7!.command).toBe('npx');
            expect(context7!.args).toEqual(['-y', '@upstash/context7-mcp']);

            const pencil = servers.find(s => s.name === 'pencil');
            expect(pencil).toBeDefined();
            expect(pencil!.command).toBe('/path/to/mcp-server.exe');
            expect(pencil!.args).toEqual(['--app', 'antigravity']);
        });

        it('should parse HTTP transport with url', () => {
            const config = JSON.stringify({
                mcpServers: {
                    remote: {
                        url: 'https://api.example.com/mcp',
                        headers: { Authorization: 'Bearer token123' },
                    },
                },
            });

            const servers = adapter.parse(config);
            expect(servers).toHaveLength(1);
            expect(servers[0].url).toBe('https://api.example.com/mcp');
            expect(servers[0].headers).toEqual({ Authorization: 'Bearer token123' });
        });

        it('should parse HTTP transport with serverUrl', () => {
            const config = JSON.stringify({
                mcpServers: {
                    remote: {
                        serverUrl: 'https://api.example.com/mcp',
                    },
                },
            });

            const servers = adapter.parse(config);
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

        it('should parse disabled flag', () => {
            const config = JSON.stringify({
                mcpServers: {
                    disabled_server: {
                        command: 'node',
                        args: [],
                        disabled: true,
                    },
                },
            });

            const servers = adapter.parse(config);
            expect(servers[0].disabled).toBe(true);
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
            expect(adapter.parse('not json')).toEqual([]);
        });

        it('should return empty array for empty mcpServers', () => {
            expect(adapter.parse(JSON.stringify({ mcpServers: {} }))).toEqual([]);
        });

        it('should handle mcp_servers key (alternative format)', () => {
            const config = JSON.stringify({
                mcp_servers: {
                    server1: { command: 'test', args: [] },
                },
            });

            const servers = adapter.parse(config);
            expect(servers).toHaveLength(1);
        });
    });

    // ============================================================
    // Generation
    // ============================================================

    describe('generate()', () => {
        it('should generate valid mcp_config.json for stdio servers', () => {
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

        it('should generate valid mcp_config.json for HTTP servers', () => {
            const servers: MCPServerEntry[] = [
                {
                    name: 'remote',
                    command: '',
                    args: [],
                    url: 'https://api.example.com/mcp',
                    headers: { 'X-Api-Key': 'key123' },
                },
            ];

            const output = adapter.generate(servers);
            const parsed = JSON.parse(output);

            expect(parsed.mcpServers.remote.url).toBe('https://api.example.com/mcp');
            expect(parsed.mcpServers.remote.headers).toEqual({ 'X-Api-Key': 'key123' });
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

        it('should include disabled flag', () => {
            const servers: MCPServerEntry[] = [
                {
                    name: 'off',
                    command: 'node',
                    args: [],
                    disabled: true,
                },
            ];

            const output = adapter.generate(servers);
            const parsed = JSON.parse(output);
            expect(parsed.mcpServers.off.disabled).toBe(true);
        });

        it('should handle multiple servers', () => {
            const servers: MCPServerEntry[] = [
                { name: 'a', command: 'cmd1', args: ['--a'] },
                { name: 'b', command: 'cmd2', args: ['--b'] },
                { name: 'c', command: 'cmd3', args: ['--c'] },
            ];

            const output = adapter.generate(servers);
            const parsed = JSON.parse(output);
            expect(Object.keys(parsed.mcpServers)).toHaveLength(3);
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
        it('should return global ~/.gemini/settings.json when no projectRoot', () => {
            const configPath = adapter.getConfigPath();
            expect(configPath).toContain('.gemini');
            expect(configPath.endsWith('settings.json')).toBe(true);
        });

        it('should return project-level .gemini/settings.json when projectRoot given', () => {
            const configPath = adapter.getConfigPath('/my/project');
            expect(configPath).toContain('.gemini');
            expect(configPath.endsWith('settings.json')).toBe(true);
            expect(configPath).toContain('my');
            expect(configPath).toContain('project');
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
