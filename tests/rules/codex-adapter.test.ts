/**
 * Codex Adapter Tests
 */
import { describe, it, expect } from 'vitest';
import { CodexAdapter } from '../../src/rules/adapters/codex.js';

const adapter = new CodexAdapter();

describe('CodexAdapter', () => {
    describe('parse', () => {
        it('should parse SKILL.md with frontmatter', () => {
            const content = `---
name: deploy-skill
description: How to deploy the app
---
Run docker compose up.`;
            const rules = adapter.parse('.agents/skills/deploy/SKILL.md', content);
            expect(rules).toHaveLength(1);
            expect(rules[0].source).toBe('codex');
            expect(rules[0].scope).toBe('project');
            expect(rules[0].description).toBe('How to deploy the app');
            expect(rules[0].content).toBe('Run docker compose up.');
        });

        it('should parse AGENTS.md', () => {
            const rules = adapter.parse('AGENTS.md', '# Guidelines\nDo this and that.');
            expect(rules).toHaveLength(1);
            expect(rules[0].source).toBe('codex');
            expect(rules[0].scope).toBe('project');
            expect(rules[0].content).toContain('Do this and that');
        });

        it('should return empty for empty content', () => {
            expect(adapter.parse('.agents/skills/x/SKILL.md', '')).toHaveLength(0);
            expect(adapter.parse('AGENTS.md', '   ')).toHaveLength(0);
        });

        it('should return empty for unrecognized paths', () => {
            expect(adapter.parse('random.txt', 'content')).toHaveLength(0);
        });
    });

    describe('generate', () => {
        it('should generate SKILL.md with name and description frontmatter', () => {
            const files = adapter.generate([{
                id: 'codex:deploy', content: 'Deploy steps.', source: 'codex',
                scope: 'project', description: 'Deploy the app', priority: 5, hash: 'abc',
            }]);
            expect(files).toHaveLength(1);
            expect(files[0].filePath).toMatch(/^\.agents\/skills\/.*\/SKILL\.md$/);
            expect(files[0].content).toContain('description: Deploy the app');
            expect(files[0].content).toContain('Deploy steps.');
        });

        it('should auto-generate description if not provided', () => {
            const files = adapter.generate([{
                id: 'codex:test', content: '# Testing Guide\nUse vitest for all tests.',
                source: 'codex', scope: 'project', priority: 5, hash: 'abc',
            }]);
            expect(files[0].content).toContain('description:');
            // Auto-description should be derived from the first line
            expect(files[0].content).toContain('Testing Guide');
        });

        it('should truncate auto-description to 120 chars', () => {
            const longContent = 'A'.repeat(200);
            const files = adapter.generate([{
                id: 'codex:long', content: longContent, source: 'codex',
                scope: 'project', priority: 5, hash: 'abc',
            }]);
            // Check that description was auto-generated and truncated
            const lines = files[0].content.split('\n');
            const descLine = lines.find(l => l.startsWith('description:'));
            expect(descLine).toBeDefined();
            const descValue = descLine!.replace('description: ', '').replace(/'/g, '');
            expect(descValue.length).toBeLessThanOrEqual(123); // 120 + "..."
        });
    });

    describe('round-trip', () => {
        it('should survive parse → generate → parse', () => {
            const original = `---
name: my-skill
description: My deployment skill
---
Step 1: Build. Step 2: Deploy.`;
            const parsed = adapter.parse('.agents/skills/my-skill/SKILL.md', original);
            const generated = adapter.generate(parsed);
            const reparsed = adapter.parse(generated[0].filePath, generated[0].content);
            expect(reparsed[0].content).toBe(parsed[0].content);
            expect(reparsed[0].description).toBe('My deployment skill');
        });
    });
});
