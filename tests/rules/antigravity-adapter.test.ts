// Tests for Antigravity IDE Rule Format Adapter
//
// Covers:
// - GEMINI.md parsing (global rules)
// - .agents/rules/ parsing (workspace rules with/without frontmatter)
// - SKILL.md parsing (skills with YAML frontmatter)
// - Rule generation (unified to .agents/rules/)

import { describe, it, expect } from 'vitest';
import { AntigravityAdapter } from '../../src/rules/adapters/antigravity.js';
import type { UnifiedRule } from '../../src/types.js';

describe('AntigravityAdapter', () => {
    const adapter = new AntigravityAdapter();

    // ============================================================
    // Source & file patterns
    // ============================================================

    it('should have source "antigravity"', () => {
        expect(adapter.source).toBe('antigravity');
    });

    it('should have correct file patterns', () => {
        expect(adapter.filePatterns).toContain('GEMINI.md');
        expect(adapter.filePatterns).toContain('.agents/rules/*.md');
        expect(adapter.filePatterns).toContain('.agents/skills/*/SKILL.md');
        expect(adapter.filePatterns).toContain('.agent/rules/*.md');
        expect(adapter.filePatterns).toContain('.agent/skills/*/SKILL.md');
    });

    // ============================================================
    // GEMINI.md parsing
    // ============================================================

    describe('GEMINI.md parsing', () => {
        it('should parse GEMINI.md as global rule', () => {
            const rules = adapter.parse('GEMINI.md', 'always speak in chinese');
            expect(rules).toHaveLength(1);
            expect(rules[0].source).toBe('antigravity');
            expect(rules[0].scope).toBe('global');
            expect(rules[0].priority).toBe(10);
            expect(rules[0].content).toBe('always speak in chinese');
        });

        it('should handle nested GEMINI.md path', () => {
            const rules = adapter.parse('.gemini/GEMINI.md', 'use TypeScript strictly');
            expect(rules).toHaveLength(1);
            expect(rules[0].scope).toBe('global');
        });

        it('should return empty for empty GEMINI.md', () => {
            const rules = adapter.parse('GEMINI.md', '   ');
            expect(rules).toHaveLength(0);
        });
    });

    // ============================================================
    // .agents/rules/*.md parsing
    // ============================================================

    describe('.agents/rules/*.md parsing', () => {
        it('should parse plain markdown workspace rule', () => {
            const content = `# Coding Standards
Always use TypeScript strict mode.
No any types allowed.`;

            const rules = adapter.parse('.agents/rules/coding-standards.md', content);
            expect(rules).toHaveLength(1);
            expect(rules[0].source).toBe('antigravity');
            expect(rules[0].scope).toBe('project');
            expect(rules[0].priority).toBe(5);
            expect(rules[0].content).toContain('Always use TypeScript strict mode');
        });

        it('should parse workspace rule with frontmatter', () => {
            const content = `---
description: Code review guidelines
---
Always review PRs within 24 hours.
Check for security vulnerabilities.`;

            const rules = adapter.parse('.agents/rules/review.md', content);
            expect(rules).toHaveLength(1);
            expect(rules[0].description).toBe('Code review guidelines');
            expect(rules[0].content).toContain('Always review PRs within 24 hours');
        });

        it('should return empty for empty workspace rule', () => {
            const rules = adapter.parse('.agents/rules/empty.md', '---\ndescription: test\n---\n   ');
            expect(rules).toHaveLength(0);
        });

        it('should still parse legacy .agent/rules files', () => {
            const rules = adapter.parse('.agent/rules/legacy.md', 'legacy rule');
            expect(rules).toHaveLength(1);
            expect(rules[0].source).toBe('antigravity');
        });
    });

    // ============================================================
    // .agents/skills/*/SKILL.md parsing
    // ============================================================

    describe('SKILL.md parsing', () => {
        it('should parse skill with full frontmatter', () => {
            const content = `---
name: test-driven-development
description: Use when writing tests - establishes TDD workflow
---

## TDD Workflow

1. Write failing test first
2. Implement minimum code to pass
3. Refactor`;

            const rules = adapter.parse('.agents/skills/test-driven-development/SKILL.md', content);
            expect(rules).toHaveLength(1);
            expect(rules[0].source).toBe('antigravity');
            expect(rules[0].description).toBe('Use when writing tests - establishes TDD workflow');
            expect(rules[0].content).toContain('TDD Workflow');
            expect(rules[0].content).toContain('Write failing test first');
        });

        it('should parse skill without description', () => {
            const content = `---
name: quick-skill
---

Just do it.`;

            const rules = adapter.parse('.agents/skills/quick-skill/SKILL.md', content);
            expect(rules).toHaveLength(1);
            expect(rules[0].description).toBeUndefined();
            expect(rules[0].content).toBe('Just do it.');
        });

        it('should return empty for skill with empty body', () => {
            const content = `---
name: empty-skill
description: This skill has no body
---
`;
            const rules = adapter.parse('.agents/skills/empty-skill/SKILL.md', content);
            expect(rules).toHaveLength(0);
        });
    });

    // ============================================================
    // Hash uniqueness
    // ============================================================

    describe('hash consistency', () => {
        it('should produce same hash for same content', () => {
            const rules1 = adapter.parse('GEMINI.md', 'use strict mode');
            const rules2 = adapter.parse('.agents/rules/strict.md', 'use strict mode');
            expect(rules1[0].hash).toBe(rules2[0].hash);
        });

        it('should produce different hash for different content', () => {
            const rules1 = adapter.parse('GEMINI.md', 'use strict mode');
            const rules2 = adapter.parse('GEMINI.md', 'use TypeScript');
            expect(rules1[0].hash).not.toBe(rules2[0].hash);
        });
    });

    // ============================================================
    // Rule generation
    // ============================================================

    describe('generate()', () => {
        it('should generate .agents/rules/*.md files', () => {
            const rules: UnifiedRule[] = [
                {
                    id: 'antigravity:coding-standards',
                    content: 'Always use TypeScript strict mode.',
                    source: 'antigravity',
                    scope: 'project',
                    priority: 5,
                    hash: 'abc123',
                },
            ];

            const files = adapter.generate(rules);
            expect(files).toHaveLength(1);
            expect(files[0].filePath).toMatch(/^\.agents\/rules\/.+\.md$/);
            expect(files[0].content).toContain('Always use TypeScript strict mode');
        });

        it('should include description in frontmatter when present', () => {
            const rules: UnifiedRule[] = [
                {
                    id: 'cursor:my-rule',
                    content: 'Follow DRY principle.',
                    description: 'DRY coding principle',
                    source: 'cursor',
                    scope: 'project',
                    priority: 5,
                    hash: 'def456',
                },
            ];

            const files = adapter.generate(rules);
            expect(files).toHaveLength(1);
            expect(files[0].content).toContain('description: DRY coding principle');
            expect(files[0].content).toContain('Follow DRY principle');
        });

        it('should handle rules from other sources', () => {
            const rules: UnifiedRule[] = [
                {
                    id: 'windsurf:global-rule',
                    content: 'Always explain your reasoning.',
                    source: 'windsurf',
                    scope: 'global',
                    priority: 10,
                    hash: 'ghi789',
                },
                {
                    id: 'claude-code:path-rule',
                    content: 'Use React hooks only.',
                    source: 'claude-code',
                    scope: 'path-specific',
                    paths: ['src/components/**'],
                    priority: 5,
                    hash: 'jkl012',
                },
            ];

            const files = adapter.generate(rules);
            expect(files).toHaveLength(2);
            // All should go to .agents/rules/
            for (const f of files) {
                expect(f.filePath).toMatch(/^\.agents\/rules\/.+\.md$/);
            }
        });

        it('should generate empty array for empty rules', () => {
            const files = adapter.generate([]);
            expect(files).toHaveLength(0);
        });
    });

    // ============================================================
    // Edge cases
    // ============================================================

    describe('edge cases', () => {
        it('should ignore unknown file paths', () => {
            const rules = adapter.parse('random-file.txt', 'some content');
            expect(rules).toHaveLength(0);
        });

        it('should handle GEMINI.md with only whitespace and newlines', () => {
            const rules = adapter.parse('GEMINI.md', '\n\n  \n');
            expect(rules).toHaveLength(0);
        });

        it('should trim content properly', () => {
            const rules = adapter.parse('GEMINI.md', '\n  always use strict mode  \n\n');
            expect(rules[0].content).toBe('always use strict mode');
        });
    });
});
