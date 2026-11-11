/**
 * Claude Code Adapter Tests
 */
import { describe, it, expect } from 'vitest';
import { ClaudeCodeAdapter } from '../../src/rules/adapters/claude-code.js';

const adapter = new ClaudeCodeAdapter();

describe('ClaudeCodeAdapter', () => {
    describe('parse', () => {
        it('should parse CLAUDE.md as project scope', () => {
            const rules = adapter.parse('CLAUDE.md', '# Rules\nAlways use TypeScript.');
            expect(rules).toHaveLength(1);
            expect(rules[0].source).toBe('claude-code');
            expect(rules[0].scope).toBe('project');
            expect(rules[0].content).toContain('Always use TypeScript');
        });

        it('should parse .claude/CLAUDE.md', () => {
            const rules = adapter.parse('.claude/CLAUDE.md', 'Use strict mode.');
            expect(rules).toHaveLength(1);
            expect(rules[0].scope).toBe('project');
        });

        it('should parse .claude/rules/*.md with paths frontmatter', () => {
            const content = `---
paths:
  - "src/api/**"
  - "src/routes/**"
---
Follow REST conventions.`;
            const rules = adapter.parse('.claude/rules/api.md', content);
            expect(rules).toHaveLength(1);
            expect(rules[0].scope).toBe('path-specific');
            expect(rules[0].paths).toEqual(['src/api/**', 'src/routes/**']);
        });

        it('should parse .claude/rules/*.md without paths as project scope', () => {
            const content = `---
description: General coding rules
---
Write clean code.`;
            const rules = adapter.parse('.claude/rules/general.md', content);
            expect(rules).toHaveLength(1);
            expect(rules[0].scope).toBe('project');
            expect(rules[0].description).toBe('General coding rules');
        });

        it('should return empty for empty content', () => {
            expect(adapter.parse('CLAUDE.md', '')).toHaveLength(0);
            expect(adapter.parse('CLAUDE.md', '   ')).toHaveLength(0);
        });
    });

    describe('generate', () => {
        it('should generate CLAUDE.md for project rules', () => {
            const files = adapter.generate([{
                id: 'test', content: 'Use TypeScript.', source: 'claude-code',
                scope: 'project', priority: 5, hash: 'abc',
            }]);
            expect(files).toHaveLength(1);
            expect(files[0].filePath).toBe('CLAUDE.md');
        });

        it('should generate .claude/rules/*.md for path-specific rules', () => {
            const files = adapter.generate([{
                id: 'claude-code:api', content: 'REST rules', source: 'claude-code',
                scope: 'path-specific', paths: ['src/api/**'], priority: 5, hash: 'abc',
            }]);
            expect(files).toHaveLength(1);
            expect(files[0].filePath).toMatch(/^\.claude\/rules\//);
            expect(files[0].content).toContain('src/api/**');
        });
    });

    describe('round-trip', () => {
        it('should survive parse → generate → parse for path rules', () => {
            const original = `---
paths:
  - "src/**/*.ts"
---
Use strict TypeScript.`;
            const parsed = adapter.parse('.claude/rules/ts.md', original);
            const generated = adapter.generate(parsed);
            const reparsed = adapter.parse(generated[0].filePath, generated[0].content);
            expect(reparsed[0].content).toBe(parsed[0].content);
            expect(reparsed[0].scope).toBe('path-specific');
        });
    });
});
