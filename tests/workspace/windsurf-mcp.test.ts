/**
 * Windsurf MCP Adapter Tests
 */
import { describe, it, expect } from 'vitest';
import { WindsurfMCPAdapter } from '../../src/workspace/mcp-adapters/windsurf.js';

const adapter = new WindsurfMCPAdapter();

describe('WindsurfMCPAdapter', () => {
    describe('parse', () => {
        it('should parse stdio servers', () => {
            const config = JSON.stringify({
                mcpServers: {
                    memorix: { command: 'npx', args: ['-y', 'memorix', 'serve'] },
                },
            });
            const servers = adapter.parse(config);
            expect(servers).toHaveLength(1);
            expect(servers[0].command).toBe('npx');
        });

        it('should parse HTTP servers with serverUrl (Windsurf-specific)', () => {
            const config = JSON.stringify({
                mcpServers: {
                    remote: { serverUrl: 'https://api.example.com/mcp' },
                },
            });
            const servers = adapter.parse(config);
            expect(servers[0].url).toBe('https://api.example.com/mcp');
        });

        it('should parse headers for HTTP transport', () => {
            const config = JSON.stringify({
                mcpServers: {
                    remote: {
                        serverUrl: 'https://example.com',
                        headers: { Authorization: 'Bearer token123' },
                    },
                },
            });
            const servers = adapter.parse(config);
            expect(servers[0].headers).toEqual({ Authorization: 'Bearer token123' });
        });

        it('should parse disabled flag', () => {
            const config = JSON.stringify({
                mcpServers: {
                    svc: { command: 'node', args: [], disabled: true },
                },
            });
            const servers = adapter.parse(config);
            expect(servers[0].disabled).toBe(true);
        });

        it('should handle null env gracefully', () => {
            const config = JSON.stringify({
                mcpServers: {
                    svc: { command: 'node', args: [], env: null },
                },
            });
            const servers = adapter.parse(config);
            expect(servers[0].env).toBeUndefined();
        });

        it('should support mcp_servers key (legacy format)', () => {
            const config = JSON.stringify({
                mcp_servers: {
                    legacy: { command: 'node', args: ['srv.js'] },
                },
            });
            const servers = adapter.parse(config);
            expect(servers).toHaveLength(1);
            expect(servers[0].name).toBe('legacy');
        });

        it('should return empty for invalid JSON', () => {
            expect(adapter.parse('invalid')).toEqual([]);
        });
    });

    describe('generate', () => {
        it('should generate serverUrl for HTTP transport (not url)', () => {
            const output = adapter.generate([
                { name: 'remote', command: '', args: [], url: 'https://example.com' },
            ]);
            const parsed = JSON.parse(output);
            expect(parsed.mcpServers.remote.serverUrl).toBe('https://example.com');
            expect(parsed.mcpServers.remote.url).toBeUndefined();
        });

        it('should include disabled flag', () => {
            const output = adapter.generate([
                { name: 'svc', command: 'node', args: [], disabled: true },
            ]);
            const parsed = JSON.parse(output);
            expect(parsed.mcpServers.svc.disabled).toBe(true);
        });

        it('should include headers for HTTP transport', () => {
            const output = adapter.generate([
                { name: 'svc', command: '', args: [], url: 'https://x.com', headers: { Auth: 'Bearer tok' } },
            ]);
            const parsed = JSON.parse(output);
            expect(parsed.mcpServers.svc.headers).toEqual({ Auth: 'Bearer tok' });
        });
    });

    describe('getConfigPath', () => {
        it('should return windsurf config path', () => {
            const p = adapter.getConfigPath();
            expect(p).toContain('windsurf');
            expect(p).toContain('mcp_config.json');
        });
    });

    describe('round-trip', () => {
        it('should survive parse → generate → parse for stdio', () => {
            const original = JSON.stringify({
                mcpServers: {
                    svc: { command: 'npx', args: ['-y', 'pkg'], env: { K: 'v' } },
                },
            });
            const servers = adapter.parse(original);
            const generated = adapter.generate(servers);
            const reparsed = adapter.parse(generated);
            expect(reparsed[0].name).toBe('svc');
            expect(reparsed[0].command).toBe('npx');
            expect(reparsed[0].env).toEqual({ K: 'v' });
        });

        it('should survive parse → generate → parse for HTTP', () => {
            const original = JSON.stringify({
                mcpServers: {
                    api: { serverUrl: 'https://example.com/mcp', headers: { X: 'Y' } },
                },
            });
            const servers = adapter.parse(original);
            const generated = adapter.generate(servers);
            const reparsed = adapter.parse(generated);
            expect(reparsed[0].url).toBe('https://example.com/mcp');
            expect(reparsed[0].headers).toEqual({ X: 'Y' });
        });
    });
});
