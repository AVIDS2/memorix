/**
 * Tests for TraeAdapter
 *
 * Covers parsing and generation for:
 * - .trae/rules/project_rules.md (project-level, plain Markdown)
 * - .trae/rules/*.md (other rule files)
 *
 * Source: https://docs.trae.ai/ide/rules
 */
import { describe, it, expect } from 'vitest';
import { TraeAdapter } from '../../src/rules/adapters/trae.js';

describe('TraeAdapter', () => {
    const adapter = new TraeAdapter();

    describe('source', () => {
        it('should have source "trae"', () => {
            expect(adapter.source).toBe('trae');
        });
    });

    describe('filePatterns', () => {
        it('should include .trae/rules patterns', () => {
            expect(adapter.filePatterns).toContain('.trae/rules/project_rules.md');
            expect(adapter.filePatterns).toContain('.trae/rules/*.md');
        });
    });

    // ---- Parsing ----
    describe('parse', () => {
        it('should parse project_rules.md', () => {
            const content = '## Naming Conventions\nVariables use camelCase.\n\n## React\n- Use Hooks';
            const rules = adapter.parse('.trae/rules/project_rules.md', content);

            expect(rules).toHaveLength(1);
            expect(rules[0].source).toBe('trae');
            expect(rules[0].scope).toBe('project');
            expect(rules[0].content).toBe(content);
            expect(rules[0].description).toBe('Trae project rules');
            expect(rules[0].alwaysApply).toBe(true);
            expect(rules[0].priority).toBe(10);
        });

        it('should parse other .trae/rules/*.md files', () => {
            const rules = adapter.parse('.trae/rules/coding-style.md', '# Coding Style\nUse 2 spaces.');

            expect(rules).toHaveLength(1);
            expect(rules[0].source).toBe('trae');
            expect(rules[0].scope).toBe('project');
            expect(rules[0].priority).toBe(5);
            expect(rules[0].description).toBeUndefined();
        });

        it('should return empty for blank content', () => {
            expect(adapter.parse('.trae/rules/project_rules.md', '')).toHaveLength(0);
            expect(adapter.parse('.trae/rules/project_rules.md', '   ')).toHaveLength(0);
        });

        it('should have a unique id and hash', () => {
            const rules = adapter.parse('.trae/rules/project_rules.md', 'Test content');
            expect(rules[0].id).toBeTruthy();
            expect(rules[0].hash).toBeTruthy();
        });
    });

    // ---- Generation ----
    describe('generate', () => {
        it('should generate single project_rules.md for one rule', () => {
            const files = adapter.generate([
                {
                    id: 'test-rule',
                    content: '# My Rules\nUse TypeScript.',
                    source: 'trae',
                    scope: 'project',
                    priority: 10,
                    hash: 'abc',
                },
            ]);

            expect(files).toHaveLength(1);
            expect(files[0].filePath).toBe('.trae/rules/project_rules.md');
            expect(files[0].content).toBe('# My Rules\nUse TypeScript.');
        });

        it('should merge multiple rules with separator', () => {
            const files = adapter.generate([
                { id: 'r1', content: 'Rule 1', source: 'trae', scope: 'project', priority: 5, hash: 'a' },
                { id: 'r2', content: 'Rule 2', source: 'trae', scope: 'project', priority: 5, hash: 'b' },
            ]);

            expect(files).toHaveLength(1);
            expect(files[0].content).toContain('Rule 1');
            expect(files[0].content).toContain('Rule 2');
            expect(files[0].content).toContain('---');
        });

        it('should return empty for no rules', () => {
            expect(adapter.generate([])).toHaveLength(0);
        });
    });
});
