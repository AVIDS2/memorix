/**
 * Antigravity IDE Rule Format Adapter
 *
 * Parses and generates rules in Antigravity's formats:
 * - GEMINI.md (global rules, similar to CLAUDE.md)
 * - .agents/rules/*.md (workspace rules, Markdown with optional frontmatter)
 * - .agents/skills/[name]/SKILL.md (skills, Markdown + YAML frontmatter)
 *
 * Source: https://antigravity.google/docs/rules
 *
 * Note: Antigravity is Google's agent-first IDE, a VS Code fork.
 * Global rules: ~/.gemini/GEMINI.md
 * Workspace rules: <project>/.agents/rules/*.md
 * Skills: <project>/.agents/skills/[name]/SKILL.md
 */

import matter from 'gray-matter';
import type { RuleFormatAdapter, UnifiedRule, RuleSource } from '../../types.js';
import { hashContent, generateRuleId } from '../utils.js';

export class AntigravityAdapter implements RuleFormatAdapter {
  readonly source: RuleSource = 'antigravity';

  readonly filePatterns = [
    'GEMINI.md',
    '.agents/rules/*.md',
    '.agents/skills/*/SKILL.md',
    '.agent/rules/*.md',
    '.agent/skills/*/SKILL.md',
  ];

  parse(filePath: string, content: string): UnifiedRule[] {
    // .agents/skills/*/SKILL.md — skill files with frontmatter
    if (filePath.includes('SKILL.md')) {
      return this.parseSkillMd(filePath, content);
    }
    // .agents/rules/*.md — workspace rules
    if (filePath.includes('.agents/rules/') || filePath.includes('.agent/rules/')) {
      return this.parseAgentRule(filePath, content);
    }
    // GEMINI.md — global project-level rules
    if (filePath === 'GEMINI.md' || filePath.endsWith('/GEMINI.md')) {
      return this.parseGeminiMd(filePath, content);
    }
    return [];
  }

  generate(rules: UnifiedRule[]): { filePath: string; content: string }[] {
    const projectRules = rules.filter(r => r.scope !== 'path-specific');
    const pathRules = rules.filter(r => r.scope === 'path-specific');

    const files: { filePath: string; content: string }[] = [];

    // Generate workspace rules as .agents/rules/*.md
    for (const rule of [...projectRules, ...pathRules]) {
      const fm: Record<string, unknown> = {};
      if (rule.description) fm.description = rule.description;

      const fileName = rule.id
        .replace(/^antigravity:/, '')
        .replace(/[^a-zA-Z0-9-_]/g, '-')
        || 'rule';

      const body = Object.keys(fm).length > 0
        ? matter.stringify(rule.content, fm)
        : rule.content;

      files.push({
        filePath: `.agents/rules/${fileName}.md`,
        content: body,
      });
    }

    return files;
  }

  private parseGeminiMd(filePath: string, content: string): UnifiedRule[] {
    const trimmed = content.trim();
    if (!trimmed) return [];

    return [{
      id: generateRuleId('antigravity', filePath),
      content: trimmed,
      source: 'antigravity',
      scope: 'global',
      priority: 10,
      hash: hashContent(trimmed),
    }];
  }

  private parseAgentRule(filePath: string, content: string): UnifiedRule[] {
    const { data, content: body } = matter(content);
    const trimmed = body.trim();
    if (!trimmed) return [];

    return [{
      id: generateRuleId('antigravity', filePath),
      content: trimmed,
      description: data.description as string | undefined,
      source: 'antigravity',
      scope: 'project',
      priority: 5,
      hash: hashContent(trimmed),
    }];
  }

  private parseSkillMd(filePath: string, content: string): UnifiedRule[] {
    const { data, content: body } = matter(content);
    const trimmed = body.trim();
    if (!trimmed) return [];

    return [{
      id: generateRuleId('antigravity', filePath),
      content: trimmed,
      description: (data.description as string) || undefined,
      source: 'antigravity',
      scope: 'project',
      priority: 5,
      hash: hashContent(trimmed),
    }];
  }
}
