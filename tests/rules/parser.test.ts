// Rules Parser Tests — TDD RED Phase
//
// Tests all 4 agent format adapters:
// - Cursor (.cursor/rules/.mdc, .cursorrules, AGENTS.md)
// - Claude Code (CLAUDE.md, .claude/rules/.md)
// - Codex (.agents/skills/SKILL.md)
// - Windsurf (.windsurfrules, .windsurf/rules/.md)
//
// Each adapter implements the RuleFormatAdapter interface.

import { describe, it, expect } from 'vitest';
import { CursorAdapter } from '../../src/rules/adapters/cursor.js';
import { ClaudeCodeAdapter } from '../../src/rules/adapters/claude-code.js';
import { CodexAdapter } from '../../src/rules/adapters/codex.js';
import { WindsurfAdapter } from '../../src/rules/adapters/windsurf.js';
import type { UnifiedRule } from '../../src/types.js';

// ================================================================
// Cursor Adapter
// ================================================================

describe('CursorAdapter', () => {
  const adapter = new CursorAdapter();

  it('should have correct source and file patterns', () => {
    expect(adapter.source).toBe('cursor');
    expect(adapter.filePatterns).toContain('.cursor/rules/*.mdc');
    expect(adapter.filePatterns).toContain('.cursorrules');
  });

  describe('parse .mdc with frontmatter', () => {
    it('should parse description and content', () => {
      const content = `---
description: "Frontend component standards"
alwaysApply: false
---
- Always use Tailwind for styling
- Use Framer Motion for animations`;

      const rules = adapter.parse('.cursor/rules/frontend.mdc', content);
      expect(rules).toHaveLength(1);
      expect(rules[0].source).toBe('cursor');
      expect(rules[0].description).toBe('Frontend component standards');
      expect(rules[0].alwaysApply).toBe(false);
      expect(rules[0].content).toContain('Tailwind');
      expect(rules[0].scope).toBe('project');
    });

    it('should parse globs into paths', () => {
      const content = `---
description: "API rules"
globs: ["src/api/**/*.ts", "tests/api/**/*.ts"]
---
- Validate all inputs`;

      const rules = adapter.parse('.cursor/rules/api.mdc', content);
      expect(rules[0].paths).toEqual(['src/api/**/*.ts', 'tests/api/**/*.ts']);
      expect(rules[0].scope).toBe('path-specific');
    });

    it('should handle alwaysApply: true', () => {
      const content = `---
description: "Global coding standards"
alwaysApply: true
---
- Use TypeScript strict mode`;

      const rules = adapter.parse('.cursor/rules/global.mdc', content);
      expect(rules[0].alwaysApply).toBe(true);
      expect(rules[0].scope).toBe('global');
    });
  });

  describe('parse .cursorrules (legacy)', () => {
    it('should parse plain text as single rule', () => {
      const content = `You are an expert TypeScript developer.
Always use functional programming patterns.
Never use any.`;

      const rules = adapter.parse('.cursorrules', content);
      expect(rules).toHaveLength(1);
      expect(rules[0].content).toContain('TypeScript');
      expect(rules[0].scope).toBe('project');
      expect(rules[0].description).toBeUndefined();
    });
  });

  describe('parse AGENTS.md', () => {
    it('should parse markdown as single rule', () => {
      const content = `# Project Rules

## Code Style
- Use 2-space indentation
- Prefer const over let

## Testing
- Write tests for all public APIs`;

      const rules = adapter.parse('AGENTS.md', content);
      expect(rules).toHaveLength(1);
      expect(rules[0].content).toContain('Code Style');
      expect(rules[0].scope).toBe('project');
    });
  });

  describe('generate', () => {
    it('should generate .mdc format with frontmatter', () => {
      const rules: UnifiedRule[] = [{
        id: 'test-1',
        content: '- Use TypeScript strict mode',
        description: 'TypeScript standards',
        source: 'cursor',
        scope: 'project',
        priority: 1,
        hash: 'abc123',
      }];

      const files = adapter.generate(rules);
      expect(files).toHaveLength(1);
      expect(files[0].filePath).toMatch(/\.cursor\/rules\/.*\.mdc$/);
      expect(files[0].content).toContain('description:');
      expect(files[0].content).toContain('TypeScript');
    });
  });
});

// ================================================================
// Claude Code Adapter
// ================================================================

describe('ClaudeCodeAdapter', () => {
  const adapter = new ClaudeCodeAdapter();

  it('should have correct source and file patterns', () => {
    expect(adapter.source).toBe('claude-code');
    expect(adapter.filePatterns).toContain('CLAUDE.md');
    expect(adapter.filePatterns).toContain('.claude/rules/*.md');
  });

  describe('parse CLAUDE.md', () => {
    it('should parse markdown as single project rule', () => {
      const content = `# Project Guidelines

- Always write tests first
- Use ESM modules
- Target Node.js 20+`;

      const rules = adapter.parse('CLAUDE.md', content);
      expect(rules).toHaveLength(1);
      expect(rules[0].source).toBe('claude-code');
      expect(rules[0].content).toContain('ESM modules');
      expect(rules[0].scope).toBe('project');
    });
  });

  describe('parse .claude/rules/*.md with paths frontmatter', () => {
    it('should parse paths into scope', () => {
      const content = `---
paths:
  - "src/api/**/*.ts"
  - "tests/**/*.test.ts"
---
# API Development Rules
- All API endpoints must include input validation
- Use the standard error response format`;

      const rules = adapter.parse('.claude/rules/api-rules.md', content);
      expect(rules).toHaveLength(1);
      expect(rules[0].paths).toEqual(['src/api/**/*.ts', 'tests/**/*.test.ts']);
      expect(rules[0].scope).toBe('path-specific');
      expect(rules[0].content).toContain('input validation');
    });

    it('should handle rules without frontmatter', () => {
      const content = `# General Rules
- Keep functions short
- Use meaningful variable names`;

      const rules = adapter.parse('.claude/rules/general.md', content);
      expect(rules).toHaveLength(1);
      expect(rules[0].scope).toBe('project');
      expect(rules[0].paths).toBeUndefined();
    });
  });

  describe('generate', () => {
    it('should generate CLAUDE.md for project-scope rules', () => {
      const rules: UnifiedRule[] = [{
        id: 'test-1',
        content: '- Use TypeScript',
        source: 'claude-code',
        scope: 'project',
        priority: 1,
        hash: 'abc',
      }];

      const files = adapter.generate(rules);
      expect(files.length).toBeGreaterThanOrEqual(1);
      expect(files.some(f => f.filePath.includes('CLAUDE.md'))).toBe(true);
    });

    it('should generate .claude/rules/*.md for path-specific rules', () => {
      const rules: UnifiedRule[] = [{
        id: 'test-2',
        content: '- Validate API inputs',
        description: 'API rules',
        source: 'claude-code',
        scope: 'path-specific',
        paths: ['src/api/**/*.ts'],
        priority: 1,
        hash: 'def',
      }];

      const files = adapter.generate(rules);
      expect(files.some(f => f.filePath.includes('.claude/rules/'))).toBe(true);
      expect(files.some(f => f.content.includes('paths:'))).toBe(true);
    });
  });
});

// ================================================================
// Codex Adapter
// ================================================================

describe('CodexAdapter', () => {
  const adapter = new CodexAdapter();

  it('should have correct source and file patterns', () => {
    expect(adapter.source).toBe('codex');
    expect(adapter.filePatterns).toContain('.agents/skills/*/SKILL.md');
  });

  describe('parse SKILL.md', () => {
    it('should parse name and description from frontmatter', () => {
      const content = `---
name: test-driven-development
description: Use when implementing any feature or bugfix
---
# Test-Driven Development

Write the test first. Watch it fail. Write minimal code to pass.`;

      const rules = adapter.parse('.agents/skills/tdd/SKILL.md', content);
      expect(rules).toHaveLength(1);
      expect(rules[0].source).toBe('codex');
      expect(rules[0].description).toBe('Use when implementing any feature or bugfix');
      expect(rules[0].content).toContain('test first');
      expect(rules[0].scope).toBe('project');
    });

    it('should parse AGENTS.md as project rule', () => {
      const content = `# Agent Instructions
- Follow the coding standards`;

      const rules = adapter.parse('AGENTS.md', content);
      expect(rules).toHaveLength(1);
      expect(rules[0].scope).toBe('project');
    });
  });

  describe('generate', () => {
    it('should generate SKILL.md with name/description frontmatter', () => {
      const rules: UnifiedRule[] = [{
        id: 'test-skill',
        content: '# My Skill\nDo the thing.',
        description: 'Use when doing the thing',
        source: 'codex',
        scope: 'project',
        priority: 1,
        hash: 'xyz',
      }];

      const files = adapter.generate(rules);
      expect(files).toHaveLength(1);
      expect(files[0].filePath).toMatch(/\.agents\/skills\/.*\/SKILL\.md$/);
      expect(files[0].content).toContain('name:');
      expect(files[0].content).toContain('description:');
    });
  });
});

// ================================================================
// Windsurf Adapter
// ================================================================

describe('WindsurfAdapter', () => {
  const adapter = new WindsurfAdapter();

  it('should have correct source and file patterns', () => {
    expect(adapter.source).toBe('windsurf');
    expect(adapter.filePatterns).toContain('.windsurfrules');
    expect(adapter.filePatterns).toContain('.windsurf/rules/*.md');
  });

  describe('parse .windsurfrules (legacy)', () => {
    it('should parse plain text as single rule', () => {
      const content = `You are an expert developer.
Follow best practices.
Write clean code.`;

      const rules = adapter.parse('.windsurfrules', content);
      expect(rules).toHaveLength(1);
      expect(rules[0].source).toBe('windsurf');
      expect(rules[0].content).toContain('best practices');
      expect(rules[0].scope).toBe('project');
    });
  });

  describe('parse .windsurf/rules/*.md', () => {
    it('should parse markdown with optional frontmatter', () => {
      const content = `---
description: "Code review guidelines"
---
# Code Review
- Check for edge cases
- Verify error handling`;

      const rules = adapter.parse('.windsurf/rules/review.md', content);
      expect(rules).toHaveLength(1);
      expect(rules[0].description).toBe('Code review guidelines');
      expect(rules[0].content).toContain('edge cases');
    });

    it('should handle files without frontmatter', () => {
      const content = `# Style Guide
- Use semicolons
- Prefer arrow functions`;

      const rules = adapter.parse('.windsurf/rules/style.md', content);
      expect(rules).toHaveLength(1);
      expect(rules[0].scope).toBe('project');
    });
  });

  describe('generate', () => {
    it('should generate .windsurf/rules/*.md format', () => {
      const rules: UnifiedRule[] = [{
        id: 'ws-1',
        content: '- Use TypeScript',
        description: 'Language standard',
        source: 'windsurf',
        scope: 'project',
        priority: 1,
        hash: 'abc',
      }];

      const files = adapter.generate(rules);
      expect(files).toHaveLength(1);
      expect(files[0].filePath).toMatch(/\.windsurf\/rules\/.*\.md$/);
    });
  });
});

// ================================================================
// Cross-format: hash and dedup
// ================================================================

describe('Cross-adapter consistency', () => {
  it('all adapters should produce rules with hash field', () => {
    const cursor = new CursorAdapter();
    const claude = new ClaudeCodeAdapter();
    const codex = new CodexAdapter();
    const windsurf = new WindsurfAdapter();

    const content = '- Use TypeScript strict mode';

    const cr = cursor.parse('.cursorrules', content);
    const cl = claude.parse('CLAUDE.md', content);
    const cx = codex.parse('AGENTS.md', content);
    const ws = windsurf.parse('.windsurfrules', content);

    for (const rules of [cr, cl, cx, ws]) {
      expect(rules).toHaveLength(1);
      expect(rules[0].hash).toBeTruthy();
      expect(typeof rules[0].hash).toBe('string');
    }
  });

  it('same content should produce same hash regardless of source', () => {
    const cursor = new CursorAdapter();
    const windsurf = new WindsurfAdapter();

    const content = '- Use TypeScript strict mode';
    const cr = cursor.parse('.cursorrules', content);
    const ws = windsurf.parse('.windsurfrules', content);

    expect(cr[0].hash).toBe(ws[0].hash);
  });
});
