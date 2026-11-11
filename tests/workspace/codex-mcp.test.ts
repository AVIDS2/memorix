/**
 * Codex MCP Adapter Tests
 */
import { describe, it, expect } from 'vitest';
import { CodexMCPAdapter } from '../../src/workspace/mcp-adapters/codex.js';

const adapter = new CodexMCPAdapter();

describe('CodexMCPAdapter', () => {
    describe('parse', () => {
        it('should parse TOML stdio config', () => {
            const toml = `
[mcp_servers.memorix]
command = "npx"
args = ["-y", "memorix", "serve"]
`;
            const servers = adapter.parse(toml);
            expect(servers).toHaveLength(1);
            expect(servers[0].name).toBe('memorix');
            expect(servers[0].command).toBe('npx');
            expect(servers[0].args).toEqual(['-y', 'memorix', 'serve']);
        });

        it('should parse TOML with env block', () => {
            const toml = `
[mcp_servers.svc]
command = "node"
args = ["server.js"]

[mcp_servers.svc.env]
API_KEY = "secret"
DEBUG = "1"
`;
            const servers = adapter.parse(toml);
            expect(servers[0].env).toEqual({ API_KEY: 'secret', DEBUG: '1' });
        });

        it('should parse TOML with url (HTTP transport)', () => {
            const toml = `
[mcp_servers.remote]
url = "https://api.example.com/mcp"
`;
            const servers = adapter.parse(toml);
            expect(servers[0].url).toBe('https://api.example.com/mcp');
        });

        it('should parse multiple servers', () => {
            const toml = `
[mcp_servers.a]
command = "npx"
args = ["-y", "a-mcp"]

[mcp_servers.b]
command = "node"
args = ["b.js"]
`;
            const servers = adapter.parse(toml);
            expect(servers).toHaveLength(2);
            expect(servers.map(s => s.name).sort()).toEqual(['a', 'b']);
        });

        it('should skip comments and empty lines', () => {
            const toml = `
# This is a comment
[mcp_servers.svc]
command = "node"
args = []
# another comment
`;
            const servers = adapter.parse(toml);
            expect(servers).toHaveLength(1);
        });

        it('should return empty for empty content', () => {
            expect(adapter.parse('')).toEqual([]);
            expect(adapter.parse('  ')).toEqual([]);
        });

        it('should ignore non-mcp sections', () => {
            const toml = `
[other_section]
key = "value"

[mcp_servers.real]
command = "npx"
args = []
`;
            const servers = adapter.parse(toml);
            expect(servers).toHaveLength(1);
            expect(servers[0].name).toBe('real');
        });
    });

    describe('generate', () => {
        it('should generate valid TOML for stdio servers', () => {
            const output = adapter.generate([
                { name: 'memorix', command: 'npx', args: ['-y', 'memorix', 'serve'] },
            ]);
            expect(output).toContain('[mcp_servers.memorix]');
            expect(output).toContain('command = "npx"');
            expect(output).toContain('args = ["-y", "memorix", "serve"]');
        });

        it('should generate TOML for HTTP servers with url', () => {
            const output = adapter.generate([
                { name: 'remote', command: '', args: [], url: 'https://example.com/mcp' },
            ]);
            expect(output).toContain('url = "https://example.com/mcp"');
            expect(output).not.toContain('command =');
        });

        it('should generate env block', () => {
            const output = adapter.generate([
                { name: 'svc', command: 'node', args: [], env: { KEY: 'val' } },
            ]);
            expect(output).toContain('[mcp_servers.svc.env]');
            expect(output).toContain('KEY = "val"');
        });
    });

    describe('getConfigPath', () => {
        it('should return project-level path', () => {
            const p = adapter.getConfigPath('/project');
            expect(p).toContain('.codex');
            expect(p).toContain('config.toml');
        });

        it('should return user-level path', () => {
            const p = adapter.getConfigPath();
            expect(p).toContain('.codex');
            expect(p).toContain('config.toml');
        });
    });

    describe('round-trip', () => {
        it('should survive parse → generate → parse for stdio', () => {
            const original = `
[mcp_servers.memorix]
command = "npx"
args = ["-y", "memorix", "serve"]

[mcp_servers.memorix.env]
DEBUG = "true"
`;
            const servers = adapter.parse(original);
            const generated = adapter.generate(servers);
            const reparsed = adapter.parse(generated);
            expect(reparsed[0].name).toBe('memorix');
            expect(reparsed[0].command).toBe('npx');
            expect(reparsed[0].args).toEqual(['-y', 'memorix', 'serve']);
            expect(reparsed[0].env).toEqual({ DEBUG: 'true' });
        });

        it('should survive parse → generate → parse for HTTP', () => {
            const original = `
[mcp_servers.api]
url = "https://example.com"
`;
            const servers = adapter.parse(original);
            const generated = adapter.generate(servers);
            const reparsed = adapter.parse(generated);
            expect(reparsed[0].url).toBe('https://example.com');
        });
    });
});
