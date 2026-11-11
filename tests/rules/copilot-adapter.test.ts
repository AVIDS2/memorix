/**
 * Tests for CopilotAdapter
 *
 * Covers parsing and generation for:
 * - .github/copilot-instructions.md (repository-wide)
 * - .github/instructions/*.instructions.md (path-specific with applyTo)
 */
import { describe, it, expect } from 'vitest';
import { CopilotAdapter } from '../../src/rules/adapters/copilot.js';

describe('CopilotAdapter', () => {
    const adapter = new CopilotAdapter();

    describe('source', () => {
        it('should have source "copilot"', () => {
            expect(adapter.source).toBe('copilot');
        });
    });

    describe('filePatterns', () => {
        it('should include copilot-instructions.md and instructions pattern', () => {
            expect(adapter.filePatterns).toContain('.github/copilot-instructions.md');
            expect(adapter.filePatterns).toContain('.github/instructions/*.instructions.md');
        });
    });

    // ---- Parsing: copilot-instructions.md ----
    describe('parse — copilot-instructions.md', () => {
        it('should parse repository-wide instructions', () => {
            const content = '# Project Rules\n\nUse TypeScript. Follow ESLint config.';
            const rules = adapter.parse('.github/copilot-instructions.md', content);

            expect(rules).toHaveLength(1);
            expect(rules[0].source).toBe('copilot');
            expect(rules[0].scope).toBe('project');
            expect(rules[0].content).toBe('# Project Rules\n\nUse TypeScript. Follow ESLint config.');
            expect(rules[0].description).toBe('Repository-wide Copilot instructions');
        });

        it('should return empty for blank content', () => {
            expect(adapter.parse('.github/copilot-instructions.md', '')).toHaveLength(0);
            expect(adapter.parse('.github/copilot-instructions.md', '   ')).toHaveLength(0);
        });

        it('should parse copilot-instructions.md at nested path', () => {
            const rules = adapter.parse('my-project/.github/copilot-instructions.md', 'Use Rust.');
            expect(rules).toHaveLength(1);
            expect(rules[0].source).toBe('copilot');
        });
    });

    // ---- Parsing: .instructions.md files ----
    describe('parse — path-specific instructions', () => {
        it('should parse instructions with applyTo frontmatter', () => {
            const content = `---
applyTo: "**/*.ts,**/*.tsx"
---
Use strict TypeScript. No any types.`;
            const rules = adapter.parse('.github/instructions/typescript.instructions.md', content);

            expect(rules).toHaveLength(1);
            expect(rules[0].source).toBe('copilot');
            expect(rules[0].scope).toBe('path-specific');
            expect(rules[0].content).toBe('Use strict TypeScript. No any types.');
            expect(rules[0].paths).toEqual(['**/*.ts', '**/*.tsx']);
        });

        it('should parse instructions with single applyTo glob', () => {
            const content = `---
applyTo: "app/models/**/*.rb"
---
Follow Rails conventions.`;
            const rules = adapter.parse('.github/instructions/rails.instructions.md', content);

            expect(rules).toHaveLength(1);
            expect(rules[0].paths).toEqual(['app/models/**/*.rb']);
            expect(rules[0].scope).toBe('path-specific');
        });

        it('should parse instructions with description', () => {
            const content = `---
applyTo: "**/*.py"
description: "Python coding standards"
---
Use type hints. Follow PEP 8.`;
            const rules = adapter.parse('.github/instructions/python.instructions.md', content);

            expect(rules).toHaveLength(1);
            expect(rules[0].description).toBe('Python coding standards');
            expect(rules[0].paths).toEqual(['**/*.py']);
        });

        it('should parse instructions without applyTo as project scope', () => {
            const content = `---
description: "General coding guidelines"
---
Write clean code.`;
            const rules = adapter.parse('.github/instructions/general.instructions.md', content);

            expect(rules).toHaveLength(1);
            expect(rules[0].scope).toBe('project');
            expect(rules[0].paths).toBeUndefined();
        });

        it('should return empty for blank body', () => {
            const content = `---
applyTo: "**/*.ts"
---
`;
            expect(adapter.parse('.github/instructions/empty.instructions.md', content)).toHaveLength(0);
        });

        it('should handle nested instructions directory', () => {
            const content = `---
applyTo: "src/**/*.vue"
---
Use Composition API.`;
            const rules = adapter.parse('.github/instructions/frontend/vue.instructions.md', content);
            expect(rules).toHaveLength(1);
            expect(rules[0].paths).toEqual(['src/**/*.vue']);
        });
    });

    // ---- Unrelated files ----
    describe('parse — unrelated files', () => {
        it('should return empty for non-Copilot files', () => {
            expect(adapter.parse('.cursorrules', 'content')).toHaveLength(0);
            expect(adapter.parse('CLAUDE.md', 'content')).toHaveLength(0);
            expect(adapter.parse('random.md', 'content')).toHaveLength(0);
        });
    });

    // ---- Generation ----
    describe('generate', () => {
        it('should generate copilot-instructions.md for single rule without paths', () => {
            const files = adapter.generate([{
                id: 'copilot:main',
                content: 'Use TypeScript strict mode.',
                source: 'copilot',
                scope: 'project',
                priority: 3,
                hash: 'abc123',
            }]);

            expect(files).toHaveLength(1);
            expect(files[0].filePath).toBe('.github/copilot-instructions.md');
            expect(files[0].content).toBe('Use TypeScript strict mode.');
        });

        it('should generate path-specific instruction files for multiple rules', () => {
            const files = adapter.generate([
                {
                    id: 'copilot:ts-rules',
                    content: 'Use strict types.',
                    source: 'copilot',
                    scope: 'path-specific',
                    paths: ['**/*.ts', '**/*.tsx'],
                    priority: 5,
                    hash: 'def456',
                },
                {
                    id: 'copilot:py-rules',
                    content: 'Follow PEP 8.',
                    description: 'Python standards',
                    source: 'copilot',
                    scope: 'path-specific',
                    paths: ['**/*.py'],
                    priority: 5,
                    hash: 'ghi789',
                },
            ]);

            expect(files).toHaveLength(2);
            expect(files[0].filePath).toMatch(/\.github\/instructions\/.*\.instructions\.md$/);
            expect(files[0].content).toContain('**/*.ts,**/*.tsx');
            expect(files[1].content).toContain('**/*.py');
            expect(files[1].content).toContain('Python standards');
        });

        it('should generate instruction files for single rule with paths', () => {
            const files = adapter.generate([{
                id: 'copilot:vue-rules',
                content: 'Use Composition API.',
                source: 'copilot',
                scope: 'path-specific',
                paths: ['src/**/*.vue'],
                priority: 5,
                hash: 'jkl012',
            }]);

            // Single rule but has paths → should be instruction file, not copilot-instructions.md
            expect(files).toHaveLength(1);
            expect(files[0].filePath).toMatch(/\.instructions\.md$/);
            expect(files[0].content).toContain('src/**/*.vue');
        });
    });

    // ---- Round-trip ----
    describe('round-trip', () => {
        it('should round-trip copilot-instructions.md', () => {
            const original = '# My Rules\n\nAlways use TypeScript.';
            const parsed = adapter.parse('.github/copilot-instructions.md', original);
            const generated = adapter.generate(parsed);

            expect(generated[0].content).toBe(original);
        });

        it('should round-trip path-specific instructions', () => {
            const original = `---
applyTo: "**/*.ts"
---
Use strict mode.`;
            const parsed = adapter.parse('.github/instructions/ts.instructions.md', original);

            expect(parsed[0].paths).toEqual(['**/*.ts']);
            expect(parsed[0].content).toBe('Use strict mode.');

            const generated = adapter.generate(parsed);
            expect(generated[0].content).toContain('**/*.ts');
            expect(generated[0].content).toContain('Use strict mode.');
        });
    });
});
