/**
 * Claude Code MCP Adapter Tests
 */
import { describe, it, expect } from 'vitest';
import { ClaudeCodeMCPAdapter } from '../../src/workspace/mcp-adapters/claude-code.js';
import { sep } from 'node:path';

const adapter = new ClaudeCodeMCPAdapter();

describe('ClaudeCodeMCPAdapter', () => {
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
            expect(servers[0].args).toEqual(['-y', 'memorix', 'serve']);
        });

        it('should parse HTTP servers with url', () => {
            const config = JSON.stringify({
                mcpServers: {
                    remote: { url: 'https://api.example.com/mcp' },
                },
            });
            const servers = adapter.parse(config);
            expect(servers).toHaveLength(1);
            expect(servers[0].url).toBe('https://api.example.com/mcp');
        });

        it('should parse env variables', () => {
            const config = JSON.stringify({
                mcpServers: {
                    svc: { command: 'node', args: ['server.js'], env: { API_KEY: 'secret' } },
                },
            });
            const servers = adapter.parse(config);
            expect(servers[0].env).toEqual({ API_KEY: 'secret' });
        });

        it('should omit empty env', () => {
            const config = JSON.stringify({
                mcpServers: { svc: { command: 'node', args: [], env: {} } },
            });
            const servers = adapter.parse(config);
            expect(servers[0].env).toBeUndefined();
        });

        it('should return empty for invalid JSON', () => {
            expect(adapter.parse('not json')).toEqual([]);
        });

        it('should return empty for missing mcpServers', () => {
            expect(adapter.parse('{}')).toEqual([]);
        });
    });

    describe('generate', () => {
        it('should generate valid JSON with mcpServers', () => {
            const output = adapter.generate([
                { name: 'a', command: 'npx', args: ['-y', 'a-mcp'] },
            ]);
            const parsed = JSON.parse(output);
            expect(parsed.mcpServers.a.command).toBe('npx');
            expect(parsed.mcpServers.a.args).toEqual(['-y', 'a-mcp']);
        });

        it('should generate HTTP server with url', () => {
            const output = adapter.generate([
                { name: 'remote', command: '', args: [], url: 'https://example.com' },
            ]);
            const parsed = JSON.parse(output);
            expect(parsed.mcpServers.remote.url).toBe('https://example.com');
            expect(parsed.mcpServers.remote.command).toBeUndefined();
        });
    });

    describe('getConfigPath', () => {
        it('should return project-level path with projectRoot', () => {
            const p = adapter.getConfigPath('/my/project');
            expect(p).toContain('.claude');
            expect(p).toContain('settings.json');
        });

        it('should return user-level path without projectRoot', () => {
            const p = adapter.getConfigPath();
            expect(p).toContain('.claude.json');
        });
    });

    describe('round-trip', () => {
        it('should survive parse → generate → parse', () => {
            const original = JSON.stringify({
                mcpServers: {
                    memorix: { command: 'npx', args: ['-y', 'memorix'], env: { DEBUG: '1' } },
                },
            });
            const servers = adapter.parse(original);
            const generated = adapter.generate(servers);
            const reparsed = adapter.parse(generated);
            expect(reparsed).toEqual(servers);
        });
    });
});
