/**
 * Tests for KiroAdapter
 *
 * Covers parsing and generation for:
 * - .kiro/steering/*.md (with inclusion modes: always, fileMatch, manual, auto)
 * - AGENTS.md (always included)
 *
 * Based on Kiro official documentation:
 * https://kiro.dev/docs/steering/
 */
import { describe, it, expect } from 'vitest';
import { KiroAdapter } from '../../src/rules/adapters/kiro.js';

describe('KiroAdapter', () => {
    const adapter = new KiroAdapter();

    // ---- Basic identity ----
    describe('source', () => {
        it('should have source "kiro"', () => {
            expect(adapter.source).toBe('kiro');
        });
    });

    describe('filePatterns', () => {
        it('should include steering directory and AGENTS.md', () => {
            expect(adapter.filePatterns).toContain('.kiro/steering/*.md');
            expect(adapter.filePatterns).toContain('AGENTS.md');
        });
    });

    // ---- Parsing: steering rules with inclusion modes ----
    describe('parse — steering rules', () => {

        // inclusion: always (default)
        it('should parse steering rule with inclusion: always', () => {
            const content = `---
inclusion: always
---
Use TypeScript strict mode. No any types.`;
            const rules = adapter.parse('.kiro/steering/typescript.md', content);

            expect(rules).toHaveLength(1);
            expect(rules[0].source).toBe('kiro');
            expect(rules[0].scope).toBe('global');
            expect(rules[0].alwaysApply).toBe(true);
            expect(rules[0].content).toBe('Use TypeScript strict mode. No any types.');
            expect(rules[0].priority).toBe(10);
        });

        it('should default to always when no frontmatter', () => {
            const content = 'Follow coding conventions.';
            const rules = adapter.parse('.kiro/steering/conventions.md', content);

            expect(rules).toHaveLength(1);
            expect(rules[0].scope).toBe('global');
            expect(rules[0].alwaysApply).toBe(true);
            expect(rules[0].priority).toBe(10);
        });

        // inclusion: fileMatch
        it('should parse fileMatch inclusion with single pattern', () => {
            const content = `---
inclusion: fileMatch
fileMatchPattern: "components/**/*.tsx"
---
Use functional components. No class components.`;
            const rules = adapter.parse('.kiro/steering/react.md', content);

            expect(rules).toHaveLength(1);
            expect(rules[0].scope).toBe('path-specific');
            expect(rules[0].alwaysApply).toBe(false);
            expect(rules[0].paths).toEqual(['components/**/*.tsx']);
            expect(rules[0].priority).toBe(5);
        });

        it('should parse fileMatch inclusion with array of patterns', () => {
            const content = `---
inclusion: fileMatch
fileMatchPattern:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/tsconfig.*.json"
---
TypeScript rules apply here.`;
            const rules = adapter.parse('.kiro/steering/ts-rules.md', content);

            expect(rules).toHaveLength(1);
            expect(rules[0].scope).toBe('path-specific');
            expect(rules[0].paths).toEqual(['**/*.ts', '**/*.tsx', '**/tsconfig.*.json']);
        });

        // inclusion: manual
        it('should parse manual inclusion mode', () => {
            const content = `---
inclusion: manual
---
Troubleshooting guide for deployment issues.`;
            const rules = adapter.parse('.kiro/steering/troubleshooting.md', content);

            expect(rules).toHaveLength(1);
            expect(rules[0].scope).toBe('project');
            expect(rules[0].alwaysApply).toBe(false);
            expect(rules[0].paths).toBeUndefined();
        });

        // inclusion: auto
        it('should parse auto inclusion mode', () => {
            const content = `---
inclusion: auto
name: api-design
description: REST API design patterns and conventions. Use when creating or modifying API endpoints.
---
Follow REST conventions for all API routes.`;
            const rules = adapter.parse('.kiro/steering/api-design.md', content);

            expect(rules).toHaveLength(1);
            expect(rules[0].scope).toBe('global'); // auto = always applied when relevant
            expect(rules[0].alwaysApply).toBe(true);
            expect(rules[0].description).toBe('REST API design patterns and conventions. Use when creating or modifying API endpoints.');
        });

        // with description
        it('should parse description from frontmatter', () => {
            const content = `---
inclusion: always
description: "Core TypeScript coding standards"
---
Use strict mode.`;
            const rules = adapter.parse('.kiro/steering/ts.md', content);

            expect(rules).toHaveLength(1);
            expect(rules[0].description).toBe('Core TypeScript coding standards');
        });

        // edge cases
        it('should return empty for blank body', () => {
            const content = `---
inclusion: always
---
`;
            expect(adapter.parse('.kiro/steering/empty.md', content)).toHaveLength(0);
        });

        it('should return empty for whitespace-only body', () => {
            const content = `---
inclusion: always
---
   
`;
            expect(adapter.parse('.kiro/steering/blank.md', content)).toHaveLength(0);
        });

        it('should handle file in nested steering path', () => {
            const rules = adapter.parse('my-project/.kiro/steering/api.md', 'API rules here.');
            expect(rules).toHaveLength(1);
            expect(rules[0].source).toBe('kiro');
        });
    });

    // ---- Parsing: AGENTS.md ----
    describe('parse — AGENTS.md', () => {
        it('should parse AGENTS.md as always-included rule', () => {
            const content = '# Project Agent Rules\n\nFollow all conventions.';
            const rules = adapter.parse('AGENTS.md', content);

            expect(rules).toHaveLength(1);
            expect(rules[0].source).toBe('kiro');
            expect(rules[0].scope).toBe('project');
            expect(rules[0].alwaysApply).toBe(true);
            expect(rules[0].priority).toBe(10);
            expect(rules[0].content).toBe('# Project Agent Rules\n\nFollow all conventions.');
        });

        it('should return empty for blank AGENTS.md', () => {
            expect(adapter.parse('AGENTS.md', '')).toHaveLength(0);
            expect(adapter.parse('AGENTS.md', '   ')).toHaveLength(0);
        });

        it('should parse AGENTS.md at nested path', () => {
            const rules = adapter.parse('path/to/AGENTS.md', 'Some rules.');
            expect(rules).toHaveLength(1);
            expect(rules[0].source).toBe('kiro');
        });
    });

    // ---- Unrelated files ----
    describe('parse — unrelated files', () => {
        it('should return empty for non-Kiro files', () => {
            expect(adapter.parse('.cursorrules', 'content')).toHaveLength(0);
            expect(adapter.parse('CLAUDE.md', 'content')).toHaveLength(0);
            expect(adapter.parse('.windsurf/rules/foo.md', 'content')).toHaveLength(0);
            expect(adapter.parse('random.md', 'content')).toHaveLength(0);
        });
    });

    // ---- Generation ----
    describe('generate', () => {
        it('should generate always-included steering file', () => {
            const files = adapter.generate([{
                id: 'kiro:main',
                content: 'Use TypeScript strict mode.',
                source: 'kiro',
                scope: 'global',
                alwaysApply: true,
                priority: 10,
                hash: 'abc123',
            }]);

            expect(files).toHaveLength(1);
            expect(files[0].filePath).toMatch(/\.kiro\/steering\/.*\.md$/);
            expect(files[0].content).toContain('inclusion: always');
            expect(files[0].content).toContain('Use TypeScript strict mode.');
        });

        it('should generate fileMatch steering file with paths', () => {
            const files = adapter.generate([{
                id: 'kiro:react-rules',
                content: 'Use functional components.',
                source: 'kiro',
                scope: 'path-specific',
                paths: ['**/*.tsx', '**/*.jsx'],
                priority: 5,
                hash: 'def456',
            }]);

            expect(files).toHaveLength(1);
            expect(files[0].filePath).toMatch(/\.kiro\/steering\/.*\.md$/);
            expect(files[0].content).toContain('inclusion: fileMatch');
            expect(files[0].content).toContain('fileMatchPattern');
            expect(files[0].content).toContain('Use functional components.');
        });

        it('should generate fileMatch with single path as string', () => {
            const files = adapter.generate([{
                id: 'kiro:vue-rules',
                content: 'Use Composition API.',
                source: 'kiro',
                scope: 'path-specific',
                paths: ['src/**/*.vue'],
                priority: 5,
                hash: 'ghi789',
            }]);

            expect(files).toHaveLength(1);
            // Single path should be a string, not array
            expect(files[0].content).toContain('fileMatchPattern: src/**/*.vue');
        });

        it('should generate plain steering file without frontmatter for minimal rule', () => {
            const files = adapter.generate([{
                id: 'kiro:simple',
                content: 'Simple rule.',
                source: 'kiro',
                scope: 'project',
                priority: 5,
                hash: 'jkl012',
            }]);

            expect(files).toHaveLength(1);
            expect(files[0].content).toBe('Simple rule.');
        });

        it('should include description in frontmatter', () => {
            const files = adapter.generate([{
                id: 'kiro:api',
                content: 'API rules.',
                description: 'REST API standards',
                source: 'kiro',
                scope: 'global',
                alwaysApply: true,
                priority: 10,
                hash: 'mno345',
            }]);

            expect(files).toHaveLength(1);
            expect(files[0].content).toContain('description: REST API standards');
            expect(files[0].content).toContain('inclusion: always');
        });
    });

    // ---- Round-trip ----
    describe('round-trip', () => {
        it('should round-trip always-included steering rule', () => {
            const original = `---
inclusion: always
description: "Core rules"
---
Use TypeScript. Follow ESLint.`;
            const parsed = adapter.parse('.kiro/steering/core.md', original);

            expect(parsed).toHaveLength(1);
            expect(parsed[0].content).toBe('Use TypeScript. Follow ESLint.');
            expect(parsed[0].description).toBe('Core rules');
            expect(parsed[0].alwaysApply).toBe(true);

            const generated = adapter.generate(parsed);
            expect(generated[0].content).toContain('Use TypeScript. Follow ESLint.');
            expect(generated[0].content).toContain('inclusion: always');
            expect(generated[0].content).toContain('Core rules');
        });

        it('should round-trip fileMatch steering rule', () => {
            const original = `---
inclusion: fileMatch
fileMatchPattern: "**/*.ts"
---
Use strict types.`;
            const parsed = adapter.parse('.kiro/steering/ts.md', original);

            expect(parsed[0].paths).toEqual(['**/*.ts']);
            expect(parsed[0].content).toBe('Use strict types.');

            const generated = adapter.generate(parsed);
            expect(generated[0].content).toContain('**/*.ts');
            expect(generated[0].content).toContain('Use strict types.');
            expect(generated[0].content).toContain('inclusion: fileMatch');
        });

        it('should round-trip AGENTS.md', () => {
            const original = '# Agent Rules\n\nDo not break production.';
            const parsed = adapter.parse('AGENTS.md', original);
            const generated = adapter.generate(parsed);

            expect(generated[0].content).toContain('# Agent Rules');
            expect(generated[0].content).toContain('Do not break production.');
        });
    });
});
