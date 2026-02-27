/**
 * Copilot MCP Adapter Tests
 *
 * Covers both:
 * 1. New .vscode/mcp.json format: { "servers": { ... } }
 * 2. Legacy settings.json format: { "mcp": { "servers": { ... } } }
 */
import { describe, it, expect } from 'vitest';
import { CopilotMCPAdapter } from '../../src/workspace/mcp-adapters/copilot.js';

const adapter = new CopilotMCPAdapter();

describe('CopilotMCPAdapter', () => {
    describe('parse', () => {
        it('should parse new mcp.json "servers" format', () => {
            const config = JSON.stringify({
                servers: {
                    memorix: { command: 'memorix', args: ['serve'] },
                },
            });
            const servers = adapter.parse(config);
            expect(servers).toHaveLength(1);
            expect(servers[0].name).toBe('memorix');
            expect(servers[0].command).toBe('memorix');
        });

        it('should parse legacy settings.json "mcp.servers" format', () => {
            const config = JSON.stringify({
                'editor.fontSize': 14,
                mcp: {
                    servers: {
                        memorix: { command: 'npx', args: ['-y', 'memorix', 'serve'] },
                    },
                },
            });
            const servers = adapter.parse(config);
            expect(servers).toHaveLength(1);
            expect(servers[0].name).toBe('memorix');
            expect(servers[0].command).toBe('npx');
        });

        it('should parse HTTP server with type field', () => {
            const config = JSON.stringify({
                servers: {
                    github: { type: 'http', url: 'https://api.github.com/mcp' },
                },
            });
            const servers = adapter.parse(config);
            expect(servers).toHaveLength(1);
            expect(servers[0].url).toBe('https://api.github.com/mcp');
        });

        it('should parse env, url, and headers', () => {
            const config = JSON.stringify({
                servers: {
                    svc: {
                        command: 'node', args: [],
                        env: { KEY: 'val' },
                        url: 'http://x.com',
                        headers: { Authorization: 'Bearer tok' },
                    },
                },
            });
            const servers = adapter.parse(config);
            expect(servers[0].env).toEqual({ KEY: 'val' });
            expect(servers[0].url).toBe('http://x.com');
            expect(servers[0].headers).toEqual({ Authorization: 'Bearer tok' });
        });

        it('should prefer "servers" over "mcp.servers" when both exist', () => {
            const config = JSON.stringify({
                servers: { a: { command: 'from-mcp-json', args: [] } },
                mcp: { servers: { b: { command: 'from-settings', args: [] } } },
            });
            const servers = adapter.parse(config);
            expect(servers).toHaveLength(1);
            expect(servers[0].name).toBe('a');
            expect(servers[0].command).toBe('from-mcp-json');
        });

        it('should return empty for settings without mcp key', () => {
            const config = JSON.stringify({ 'editor.fontSize': 14 });
            expect(adapter.parse(config)).toEqual([]);
        });

        it('should return empty for invalid JSON', () => {
            expect(adapter.parse('not json')).toEqual([]);
        });
    });

    describe('generate', () => {
        it('should generate new mcp.json "servers" format', () => {
            const output = adapter.generate([
                { name: 'test', command: 'npx', args: ['-y', 'test'] },
            ]);
            const parsed = JSON.parse(output);
            expect(parsed.servers.test).toBeDefined();
            expect(parsed.servers.test.command).toBe('npx');
            // Should NOT have the old mcp wrapper
            expect(parsed.mcp).toBeUndefined();
        });

        it('should generate HTTP server with type field', () => {
            const output = adapter.generate([
                { name: 'github', command: '', args: [], url: 'https://api.github.com/mcp' },
            ]);
            const parsed = JSON.parse(output);
            expect(parsed.servers.github.type).toBe('http');
            expect(parsed.servers.github.url).toBe('https://api.github.com/mcp');
        });

        it('should include headers for HTTP servers', () => {
            const output = adapter.generate([
                { name: 'svc', command: '', args: [], url: 'http://x.com', headers: { 'X-Key': 'abc' } },
            ]);
            const parsed = JSON.parse(output);
            expect(parsed.servers.svc.headers).toEqual({ 'X-Key': 'abc' });
        });
    });

    describe('getConfigPath', () => {
        it('should return .vscode/mcp.json for workspace-level', () => {
            const p = adapter.getConfigPath('/my/project');
            expect(p).toContain('.vscode');
            expect(p).toContain('mcp.json');
        });

        it('should return settings.json for global (no projectRoot)', () => {
            const p = adapter.getConfigPath();
            expect(p).toContain('settings.json');
        });
    });

    describe('round-trip', () => {
        it('should survive parse → generate → parse (new format)', () => {
            const config = JSON.stringify({
                servers: {
                    svc: { command: 'node', args: ['srv.js'], env: { PORT: '3000' } },
                },
            });
            const servers = adapter.parse(config);
            const generated = adapter.generate(servers);
            const reparsed = adapter.parse(generated);
            expect(reparsed[0].name).toBe('svc');
            expect(reparsed[0].command).toBe('node');
            expect(reparsed[0].env).toEqual({ PORT: '3000' });
        });

        it('should survive parse (legacy) → generate (new) → parse', () => {
            const config = JSON.stringify({
                mcp: {
                    servers: {
                        svc: { command: 'node', args: ['srv.js'], env: { PORT: '3000' } },
                    },
                },
            });
            const servers = adapter.parse(config);
            const generated = adapter.generate(servers);
            const reparsed = adapter.parse(generated);
            expect(reparsed[0].name).toBe('svc');
            expect(reparsed[0].command).toBe('node');
            expect(reparsed[0].env).toEqual({ PORT: '3000' });
        });
    });
});
