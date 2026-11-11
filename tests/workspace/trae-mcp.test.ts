/**
 * Tests for Trae MCP Configuration Adapter
 *
 * Covers:
 * - Parsing %APPDATA%/Trae/User/mcp.json (object-keyed format)
 * - Generating config with object-keyed format (same as Cursor)
 * - Config path resolution (user-level AppData)
 * - Edge cases (HTTP/SSE transport, env, empty config, disabled)
 *
 * Trae uses object-keyed format: { "mcpServers": { "name": { ... } } }
 * Config location: %APPDATA%/Trae/User/mcp.json (user-level, not project-level)
 *
 * Source: https://docs.trae.ai/ide/model-context-protocol
 */

import { describe, it, expect } from 'vitest';
import { TraeMCPAdapter } from '../../src/workspace/mcp-adapters/trae.js';
import type { MCPServerEntry } from '../../src/types.js';

describe('TraeMCPAdapter', () => {
    const adapter = new TraeMCPAdapter();

    // ============================================================
    // Source
    // ============================================================

    it('should have source "trae"', () => {
        expect(adapter.source).toBe('trae');
    });

    // ============================================================
    // Parsing (object-keyed format)
    // ============================================================

    describe('parse()', () => {
        it('should parse object-keyed mcpServers', () => {
            const config = JSON.stringify({
                mcpServers: {
                    memorix: {
                        command: 'memorix',
                        args: ['serve'],
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
            expect(memorix!.command).toBe('memorix');
            expect(memorix!.args).toEqual(['serve']);

            const context7 = servers.find(s => s.name === 'context7');
            expect(context7).toBeDefined();
            expect(context7!.command).toBe('npx');
            expect(context7!.args).toEqual(['-y', '@upstash/context7-mcp']);
        });

        it('should parse SSE transport with url', () => {
            const config = JSON.stringify({
                mcpServers: {
                    remote_agent: {
                        url: 'https://agent.example.com/mcp',
                    },
                },
            });

            const servers = adapter.parse(config);
            expect(servers).toHaveLength(1);
            expect(servers[0].name).toBe('remote_agent');
            expect(servers[0].url).toBe('https://agent.example.com/mcp');
        });

        it('should parse env variables', () => {
            const config = JSON.stringify({
                mcpServers: {
                    supabase_local: {
                        command: 'supabase',
                        args: ['mcp'],
                        env: { SUPABASE_ACCESS_TOKEN: 'YOUR_TOKEN' },
                    },
                },
            });

            const servers = adapter.parse(config);
            expect(servers[0].env).toEqual({ SUPABASE_ACCESS_TOKEN: 'YOUR_TOKEN' });
        });

        it('should ignore empty env objects', () => {
            const config = JSON.stringify({
                mcpServers: {
                    test: { command: 'node', args: ['server.js'], env: {} },
                },
            });

            const servers = adapter.parse(config);
            expect(servers[0].env).toBeUndefined();
        });

        it('should parse headers', () => {
            const config = JSON.stringify({
                mcpServers: {
                    remote: {
                        url: 'https://example.com/mcp',
                        headers: { Authorization: 'Bearer token' },
                    },
                },
            });

            const servers = adapter.parse(config);
            expect(servers[0].headers).toEqual({ Authorization: 'Bearer token' });
        });

        it('should parse disabled flag', () => {
            const config = JSON.stringify({
                mcpServers: {
                    disabled_server: { command: 'node', args: [], disabled: true },
                },
            });

            const servers = adapter.parse(config);
            expect(servers[0].disabled).toBe(true);
        });

        it('should return empty array for invalid JSON', () => {
            expect(adapter.parse('not valid json')).toEqual([]);
        });

        it('should return empty array for empty mcpServers object', () => {
            expect(adapter.parse(JSON.stringify({ mcpServers: {} }))).toEqual([]);
        });

        it('should return empty array for missing mcpServers key', () => {
            expect(adapter.parse(JSON.stringify({}))).toEqual([]);
        });

        it('should parse real Trae config (from actual IDE)', () => {
            const config = JSON.stringify({
                mcpServers: {
                    memorix: {
                        command: 'memorix',
                        args: ['serve'],
                    },
                },
            });

            const servers = adapter.parse(config);
            expect(servers).toHaveLength(1);
            expect(servers[0].name).toBe('memorix');
            expect(servers[0].command).toBe('memorix');
            expect(servers[0].args).toEqual(['serve']);
        });
    });

    // ============================================================
    // Generation
    // ============================================================

    describe('generate()', () => {
        it('should generate object-keyed mcpServers for stdio', () => {
            const servers: MCPServerEntry[] = [
                { name: 'memorix', command: 'memorix', args: ['serve'] },
            ];

            const output = adapter.generate(servers);
            const parsed = JSON.parse(output);

            expect(typeof parsed.mcpServers).toBe('object');
            expect(Array.isArray(parsed.mcpServers)).toBe(false);
            expect(parsed.mcpServers.memorix).toBeDefined();
            expect(parsed.mcpServers.memorix.command).toBe('memorix');
            expect(parsed.mcpServers.memorix.args).toEqual(['serve']);
        });

        it('should generate SSE transport with url (no type field)', () => {
            const servers: MCPServerEntry[] = [
                { name: 'remote', command: '', args: [], url: 'https://api.example.com/mcp' },
            ];

            const output = adapter.generate(servers);
            const parsed = JSON.parse(output);

            expect(parsed.mcpServers.remote.url).toBe('https://api.example.com/mcp');
            expect(parsed.mcpServers.remote.command).toBeUndefined();
        });

        it('should include env when present', () => {
            const servers: MCPServerEntry[] = [
                { name: 'srv', command: 'node', args: ['index.js'], env: { TOKEN: 'abc' } },
            ];

            const output = adapter.generate(servers);
            const parsed = JSON.parse(output);
            expect(parsed.mcpServers.srv.env).toEqual({ TOKEN: 'abc' });
        });

        it('should omit empty env', () => {
            const servers: MCPServerEntry[] = [
                { name: 'srv', command: 'node', args: [], env: {} },
            ];

            const output = adapter.generate(servers);
            const parsed = JSON.parse(output);
            expect(parsed.mcpServers.srv.env).toBeUndefined();
        });

        it('should handle multiple servers', () => {
            const servers: MCPServerEntry[] = [
                { name: 'a', command: 'cmd1', args: ['--a'] },
                { name: 'b', command: 'cmd2', args: ['--b'] },
            ];

            const output = adapter.generate(servers);
            const parsed = JSON.parse(output);
            expect(Object.keys(parsed.mcpServers)).toHaveLength(2);
            expect(parsed.mcpServers.a).toBeDefined();
            expect(parsed.mcpServers.b).toBeDefined();
        });

        it('should generate empty mcpServers object for empty input', () => {
            const output = adapter.generate([]);
            const parsed = JSON.parse(output);
            expect(parsed.mcpServers).toEqual({});
        });

        it('should include disabled flag', () => {
            const servers: MCPServerEntry[] = [
                { name: 'disabled', command: 'node', args: [], disabled: true },
            ];

            const output = adapter.generate(servers);
            const parsed = JSON.parse(output);
            expect(parsed.mcpServers.disabled.disabled).toBe(true);
        });

        it('should omit args when empty', () => {
            const servers: MCPServerEntry[] = [
                { name: 'simple', command: 'memorix', args: [] },
            ];

            const output = adapter.generate(servers);
            const parsed = JSON.parse(output);
            expect(parsed.mcpServers.simple.args).toBeUndefined();
        });
    });

    // ============================================================
    // Config path
    // ============================================================

    describe('getConfigPath()', () => {
        it('should return user-level AppData path containing Trae/User/mcp.json', () => {
            const configPath = adapter.getConfigPath();
            expect(configPath).toContain('Trae');
            expect(configPath).toContain('User');
            expect(configPath).toContain('mcp.json');
        });

        it('should ignore projectRoot (Trae uses user-level config only)', () => {
            const withProject = adapter.getConfigPath('/my/project');
            const without = adapter.getConfigPath();
            expect(withProject).toBe(without);
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
                        command: 'memorix',
                        args: ['serve'],
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
