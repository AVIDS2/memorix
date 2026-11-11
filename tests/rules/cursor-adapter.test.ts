/**
 * Cursor Adapter Tests
 */
import { describe, it, expect } from 'vitest';
import { CursorAdapter } from '../../src/rules/adapters/cursor.js';

const adapter = new CursorAdapter();

describe('CursorAdapter', () => {
    describe('parse', () => {
        it('should parse .mdc with alwaysApply=true as global scope', () => {
            const content = `---
description: Always active rule
alwaysApply: true
---
Use TypeScript strict mode.`;
            const rules = adapter.parse('.cursor/rules/strict.mdc', content);
            expect(rules).toHaveLength(1);
            expect(rules[0].source).toBe('cursor');
            expect(rules[0].scope).toBe('global');
            expect(rules[0].alwaysApply).toBe(true);
            expect(rules[0].priority).toBe(10);
        });

        it('should parse .mdc with globs as path-specific scope', () => {
            const content = `---
description: API rules
globs:
  - "src/api/**"
  - "src/routes/**"
---
Follow REST conventions.`;
            const rules = adapter.parse('.cursor/rules/api.mdc', content);
            expect(rules).toHaveLength(1);
            expect(rules[0].scope).toBe('path-specific');
            expect(rules[0].paths).toEqual(['src/api/**', 'src/routes/**']);
            expect(rules[0].alwaysApply).toBe(false);
        });

        it('should parse .mdc without alwaysApply or globs as project scope', () => {
            const content = `---
description: General coding rules
---
Write clean code.`;
            const rules = adapter.parse('.cursor/rules/general.mdc', content);
            expect(rules).toHaveLength(1);
            expect(rules[0].scope).toBe('project');
            expect(rules[0].alwaysApply).toBe(false);
        });

        it('should parse .cursorrules as legacy', () => {
            const rules = adapter.parse('.cursorrules', 'Legacy rules content.');
            expect(rules).toHaveLength(1);
            expect(rules[0].scope).toBe('project');
            expect(rules[0].priority).toBe(3);
        });

        it('should parse AGENTS.md', () => {
            const rules = adapter.parse('AGENTS.md', '# Agent rules\nDo X.');
            expect(rules).toHaveLength(1);
            expect(rules[0].scope).toBe('project');
        });

        it('should return empty for empty content', () => {
            expect(adapter.parse('.cursor/rules/empty.mdc', '')).toHaveLength(0);
            expect(adapter.parse('.cursorrules', '   ')).toHaveLength(0);
        });

        it('should return empty for unrecognized file path', () => {
            expect(adapter.parse('random.txt', 'content')).toHaveLength(0);
        });
    });

    describe('generate', () => {
        it('should generate .mdc files with frontmatter', () => {
            const files = adapter.generate([{
                id: 'cursor:test', content: 'Rule content', source: 'cursor',
                scope: 'global', alwaysApply: true, description: 'Test rule',
                priority: 10, hash: 'abc',
            }]);
            expect(files).toHaveLength(1);
            expect(files[0].filePath).toMatch(/\.cursor\/rules\/.*\.mdc$/);
            expect(files[0].content).toContain('alwaysApply: true');
            expect(files[0].content).toContain('description: Test rule');
        });

        it('should include globs for path-specific rules', () => {
            const files = adapter.generate([{
                id: 'cursor:api', content: 'API rules', source: 'cursor',
                scope: 'path-specific', paths: ['src/api/**'], alwaysApply: false,
                priority: 5, hash: 'abc',
            }]);
            expect(files[0].content).toContain('src/api/**');
        });
    });

    describe('round-trip', () => {
        it('should survive parse → generate → parse for alwaysApply rules', () => {
            const original = `---
description: Always on
alwaysApply: true
---
Use strict.`;
            const parsed = adapter.parse('.cursor/rules/strict.mdc', original);
            const generated = adapter.generate(parsed);
            const reparsed = adapter.parse(generated[0].filePath, generated[0].content);
            expect(reparsed[0].content).toBe(parsed[0].content);
            expect(reparsed[0].alwaysApply).toBe(true);
            expect(reparsed[0].scope).toBe('global');
        });

        it('should survive parse → generate → parse for globs rules', () => {
            const original = `---
globs:
  - "**/*.test.ts"
---
Test conventions.`;
            const parsed = adapter.parse('.cursor/rules/tests.mdc', original);
            const generated = adapter.generate(parsed);
            const reparsed = adapter.parse(generated[0].filePath, generated[0].content);
            expect(reparsed[0].scope).toBe('path-specific');
            expect(reparsed[0].paths).toEqual(['**/*.test.ts']);
        });
    });
});
