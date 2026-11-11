/**
 * Windsurf Adapter Tests
 */
import { describe, it, expect } from 'vitest';
import { WindsurfAdapter } from '../../src/rules/adapters/windsurf.js';

const adapter = new WindsurfAdapter();

describe('WindsurfAdapter', () => {
    describe('parse', () => {
        it('should parse .windsurfrules as legacy format', () => {
            const rules = adapter.parse('.windsurfrules', 'Always use functional components.');
            expect(rules).toHaveLength(1);
            expect(rules[0].source).toBe('windsurf');
            expect(rules[0].scope).toBe('project');
            expect(rules[0].priority).toBe(3);
            expect(rules[0].content).toBe('Always use functional components.');
        });

        it('should parse path-suffixed .windsurfrules', () => {
            const rules = adapter.parse('project/.windsurfrules', 'Rules here.');
            expect(rules).toHaveLength(1);
            expect(rules[0].source).toBe('windsurf');
        });

        it('should parse .windsurf/rules/*.md with frontmatter', () => {
            const content = `---
description: React rules
---
Use hooks instead of classes.`;
            const rules = adapter.parse('.windsurf/rules/react.md', content);
            expect(rules).toHaveLength(1);
            expect(rules[0].description).toBe('React rules');
            expect(rules[0].content).toBe('Use hooks instead of classes.');
            expect(rules[0].priority).toBe(5);
        });

        it('should parse .windsurf/rules/*.md without frontmatter', () => {
            const rules = adapter.parse('.windsurf/rules/general.md', 'Plain rule text.');
            expect(rules).toHaveLength(1);
            expect(rules[0].content).toBe('Plain rule text.');
        });

        it('should return empty for empty content', () => {
            expect(adapter.parse('.windsurfrules', '')).toHaveLength(0);
            expect(adapter.parse('.windsurf/rules/empty.md', '  ')).toHaveLength(0);
        });

        it('should return empty for unrecognized paths', () => {
            expect(adapter.parse('random.txt', 'content')).toHaveLength(0);
        });
    });

    describe('generate', () => {
        it('should generate .windsurf/rules/*.md files', () => {
            const files = adapter.generate([{
                id: 'windsurf:test', content: 'Rule content', source: 'windsurf',
                scope: 'project', description: 'Test description', priority: 5, hash: 'abc',
            }]);
            expect(files).toHaveLength(1);
            expect(files[0].filePath).toMatch(/^\.windsurf\/rules\//);
            expect(files[0].content).toContain('description: Test description');
            expect(files[0].content).toContain('Rule content');
        });

        it('should generate without frontmatter if no description', () => {
            const files = adapter.generate([{
                id: 'windsurf:plain', content: 'Plain content', source: 'windsurf',
                scope: 'project', priority: 5, hash: 'abc',
            }]);
            expect(files[0].content).toBe('Plain content');
        });
    });

    describe('round-trip', () => {
        it('should survive parse → generate → parse', () => {
            const original = `---
description: My rules
---
Follow TDD.`;
            const parsed = adapter.parse('.windsurf/rules/tdd.md', original);
            const generated = adapter.generate(parsed);
            const reparsed = adapter.parse(generated[0].filePath, generated[0].content);
            expect(reparsed[0].content).toBe(parsed[0].content);
            expect(reparsed[0].description).toBe('My rules');
        });
    });
});
