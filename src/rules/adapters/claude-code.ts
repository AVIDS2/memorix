/**
 * Claude Code Rule Format Adapter
 *
 * Parses and generates rules in Claude Code's formats:
 * - CLAUDE.md / .claude/CLAUDE.md (project-level Markdown)
 * - .claude/rules/*.md (Markdown with optional `paths` frontmatter)
 *
 * Source: Claude Code official documentation.
 */

import matter from '../../utils/frontmatter.js';
import type { RuleFormatAdapter, UnifiedRule, RuleSource } from '../../types.js';
import { hashContent, generateRuleId } from '../utils.js';

export class ClaudeCodeAdapter implements RuleFormatAdapter {
  readonly source: RuleSource = 'claude-code';

  readonly filePatterns = [
    'CLAUDE.md',
    '.claude/CLAUDE.md',
    '.claude/rules/*.md',
  ];

  parse(filePath: string, content: string): UnifiedRule[] {
    // .claude/rules/*.md may have `paths` frontmatter
    if (filePath.includes('.claude/rules/')) {
      return this.parseModularRule(filePath, content);
    }
    // CLAUDE.md — project-level
    return this.parseClaudeMd(filePath, content);
  }

  generate(rules: UnifiedRule[]): { filePath: string; content: string }[] {
    const projectRules = rules.filter(r => r.scope !== 'path-specific');
    const pathRules = rules.filter(r => r.scope === 'path-specific');

    const files: { filePath: string; content: string }[] = [];

    if (projectRules.length > 0) {
      files.push({
        filePath: 'CLAUDE.md',
        content: projectRules.map(r => r.content).join('\n\n'),
      });
    }

    for (const rule of pathRules) {
      const fm: Record<string, unknown> = {};
      if (rule.paths && rule.paths.length > 0) fm.paths = rule.paths;

      const fileName = rule.id
        .replace(/^claude-code:/, '')
        .replace(/[^a-zA-Z0-9-_]/g, '-')
        || 'rule';

      files.push({
        filePath: `.claude/rules/${fileName}.md`,
        content: Object.keys(fm).length > 0
          ? matter.stringify(rule.content, fm)
          : rule.content,
      });
    }

    return files;
  }

  private parseClaudeMd(filePath: string, content: string): UnifiedRule[] {
    const trimmed = content.trim();
    if (!trimmed) return [];

    return [{
      id: generateRuleId('claude-code', filePath),
      content: trimmed,
      source: 'claude-code',
      scope: 'project',
      priority: 5,
      hash: hashContent(trimmed),
    }];
  }

  private parseModularRule(filePath: string, content: string): UnifiedRule[] {
    const { data, content: body } = matter(content);
    const trimmed = body.trim();
    if (!trimmed) return [];

    const paths = data.paths as string[] | undefined;
    const hasPaths = Array.isArray(paths) && paths.length > 0;

    return [{
      id: generateRuleId('claude-code', filePath),
      content: trimmed,
      description: data.description as string | undefined,
      source: 'claude-code',
      scope: hasPaths ? 'path-specific' : 'project',
      paths: hasPaths ? paths : undefined,
      priority: 5,
      hash: hashContent(trimmed),
    }];
  }
}
