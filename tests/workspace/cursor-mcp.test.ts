/**
 * Cursor MCP Adapter Tests
 */
import { describe, it, expect } from 'vitest';
import { CursorMCPAdapter } from '../../src/workspace/mcp-adapters/cursor.js';

const adapter = new CursorMCPAdapter();

describe('CursorMCPAdapter', () => {
    describe('parse', () => {
        it('should parse stdio servers', () => {
            const config = JSON.stringify({
                mcpServers: {
                    memorix: { command: 'npx', args: ['-y', 'memorix', 'serve'] },
                },
            });
            const servers = adapter.parse(config);
            expect(servers).toHaveLength(1);
            expect(servers[0].name).toBe('memorix');
            expect(servers[0].command).toBe('npx');
        });

        it('should parse env and url', () => {
            const config = JSON.stringify({
                mcpServers: {
                    svc: { command: 'node', args: [], env: { KEY: 'val' }, url: 'http://localhost' },
                },
            });
            const servers = adapter.parse(config);
            expect(servers[0].env).toEqual({ KEY: 'val' });
            expect(servers[0].url).toBe('http://localhost');
        });

        it('should return empty for invalid JSON', () => {
            expect(adapter.parse('{')).toEqual([]);
        });

        it('should handle multiple servers', () => {
            const config = JSON.stringify({
                mcpServers: {
                    a: { command: 'a', args: [] },
                    b: { command: 'b', args: ['--flag'] },
                },
            });
            const servers = adapter.parse(config);
            expect(servers).toHaveLength(2);
        });
    });

    describe('generate', () => {
        it('should generate valid mcpServers JSON', () => {
            const output = adapter.generate([
                { name: 'test', command: 'npx', args: ['-y', 'test'] },
            ]);
            const parsed = JSON.parse(output);
            expect(parsed.mcpServers.test).toBeDefined();
        });
    });

    describe('getConfigPath', () => {
        it('should return project-level .cursor/mcp.json', () => {
            const p = adapter.getConfigPath('/project');
            expect(p).toContain('.cursor');
            expect(p).toContain('mcp.json');
        });

        it('should return user-level path without projectRoot', () => {
            const p = adapter.getConfigPath();
            expect(p).toContain('.cursor');
        });
    });

    describe('round-trip', () => {
        it('should survive parse → generate → parse', () => {
            const original = JSON.stringify({
                mcpServers: {
                    svc: { command: 'node', args: ['srv.js'], env: { PORT: '3000' } },
                },
            });
            const servers = adapter.parse(original);
            const generated = adapter.generate(servers);
            const reparsed = adapter.parse(generated);
            expect(reparsed).toEqual(servers);
        });
    });
});
