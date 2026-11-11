/**
 * OpenCode MCP Adapter Tests
 */
import { describe, it, expect } from 'vitest';
import { OpenCodeMCPAdapter } from '../../src/workspace/mcp-adapters/opencode.js';

const adapter = new OpenCodeMCPAdapter();

describe('OpenCodeMCPAdapter', () => {
    describe('parse', () => {
        it('should parse local (stdio) config', () => {
            const json = JSON.stringify({
                $schema: 'https://opencode.ai/config.json',
                mcp: {
                    memorix: {
                        type: 'local',
                        command: ['memorix', 'serve'],
                        enabled: true,
                    },
                },
            });
            const servers = adapter.parse(json);
            expect(servers).toHaveLength(1);
            expect(servers[0].name).toBe('memorix');
            expect(servers[0].command).toBe('memorix');
            expect(servers[0].args).toEqual(['serve']);
        });

        it('should parse remote (HTTP) config', () => {
            const json = JSON.stringify({
                mcp: {
                    'remote-api': {
                        type: 'remote',
                        url: 'https://api.example.com/mcp',
                        headers: { Authorization: 'Bearer token123' },
                    },
                },
            });
            const servers = adapter.parse(json);
            expect(servers).toHaveLength(1);
            expect(servers[0].name).toBe('remote-api');
            expect(servers[0].url).toBe('https://api.example.com/mcp');
            expect(servers[0].headers).toEqual({ Authorization: 'Bearer token123' });
        });

        it('should parse environment variables', () => {
            const json = JSON.stringify({
                mcp: {
                    svc: {
                        type: 'local',
                        command: ['node', 'server.js'],
                        environment: { API_KEY: 'secret', DEBUG: '1' },
                    },
                },
            });
            const servers = adapter.parse(json);
            expect(servers[0].env).toEqual({ API_KEY: 'secret', DEBUG: '1' });
        });

        it('should handle disabled servers', () => {
            const json = JSON.stringify({
                mcp: {
                    disabled: {
                        type: 'local',
                        command: ['npx', 'some-mcp'],
                        enabled: false,
                    },
                },
            });
            const servers = adapter.parse(json);
            expect(servers[0].disabled).toBe(true);
        });

        it('should parse multiple servers', () => {
            const json = JSON.stringify({
                mcp: {
                    a: { type: 'local', command: ['a-cmd'] },
                    b: { type: 'remote', url: 'https://b.com/mcp' },
                },
            });
            const servers = adapter.parse(json);
            expect(servers).toHaveLength(2);
            expect(servers.map(s => s.name).sort()).toEqual(['a', 'b']);
        });

        it('should return empty for empty content', () => {
            expect(adapter.parse('')).toEqual([]);
            expect(adapter.parse('{}')).toEqual([]);
        });

        it('should return empty for invalid JSON', () => {
            expect(adapter.parse('not json')).toEqual([]);
        });

        it('should handle string command (non-array)', () => {
            const json = JSON.stringify({
                mcp: {
                    svc: {
                        type: 'local',
                        command: 'memorix',
                    },
                },
            });
            const servers = adapter.parse(json);
            expect(servers[0].command).toBe('memorix');
            expect(servers[0].args).toEqual([]);
        });
    });

    describe('generate', () => {
        it('should generate valid JSON for stdio servers', () => {
            const output = adapter.generate([
                { name: 'memorix', command: 'memorix', args: ['serve'] },
            ]);
            const parsed = JSON.parse(output);
            expect(parsed.$schema).toBe('https://opencode.ai/config.json');
            expect(parsed.mcp.memorix.type).toBe('local');
            expect(parsed.mcp.memorix.command).toEqual(['memorix', 'serve']);
        });

        it('should generate JSON for HTTP servers', () => {
            const output = adapter.generate([
                { name: 'remote', command: '', args: [], url: 'https://example.com/mcp' },
            ]);
            const parsed = JSON.parse(output);
            expect(parsed.mcp.remote.type).toBe('remote');
            expect(parsed.mcp.remote.url).toBe('https://example.com/mcp');
        });

        it('should include environment variables', () => {
            const output = adapter.generate([
                { name: 'svc', command: 'node', args: [], env: { KEY: 'val' } },
            ]);
            const parsed = JSON.parse(output);
            expect(parsed.mcp.svc.environment).toEqual({ KEY: 'val' });
        });

        it('should set enabled false for disabled servers', () => {
            const output = adapter.generate([
                { name: 'svc', command: 'node', args: [], disabled: true },
            ]);
            const parsed = JSON.parse(output);
            expect(parsed.mcp.svc.enabled).toBe(false);
        });

        it('should include headers for HTTP servers', () => {
            const output = adapter.generate([
                { name: 'api', command: '', args: [], url: 'https://api.com', headers: { Auth: 'Bearer x' } },
            ]);
            const parsed = JSON.parse(output);
            expect(parsed.mcp.api.headers).toEqual({ Auth: 'Bearer x' });
        });
    });

    describe('getConfigPath', () => {
        it('should return project-level path', () => {
            const p = adapter.getConfigPath('/project');
            expect(p).toContain('opencode.json');
        });

        it('should return user-level path', () => {
            const p = adapter.getConfigPath();
            expect(p).toContain('opencode');
            expect(p).toContain('opencode.json');
        });
    });

    describe('round-trip', () => {
        it('should survive parse → generate → parse for stdio', () => {
            const original = JSON.stringify({
                mcp: {
                    memorix: {
                        type: 'local',
                        command: ['memorix', 'serve'],
                        environment: { DEBUG: 'true' },
                    },
                },
            });
            const servers = adapter.parse(original);
            const generated = adapter.generate(servers);
            const reparsed = adapter.parse(generated);
            expect(reparsed[0].name).toBe('memorix');
            expect(reparsed[0].command).toBe('memorix');
            expect(reparsed[0].args).toEqual(['serve']);
            expect(reparsed[0].env).toEqual({ DEBUG: 'true' });
        });

        it('should survive parse → generate → parse for HTTP', () => {
            const original = JSON.stringify({
                mcp: {
                    api: {
                        type: 'remote',
                        url: 'https://example.com',
                        headers: { 'X-Key': 'abc' },
                    },
                },
            });
            const servers = adapter.parse(original);
            const generated = adapter.generate(servers);
            const reparsed = adapter.parse(generated);
            expect(reparsed[0].url).toBe('https://example.com');
            expect(reparsed[0].headers).toEqual({ 'X-Key': 'abc' });
        });
    });
});
