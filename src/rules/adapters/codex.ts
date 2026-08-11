/**
 * OpenAI Codex Rule Format Adapter
 *
 * Parses and generates rules in Codex's formats:
 * - .agents/skills/[name]/SKILL.md (Markdown + frontmatter with name, description)
 * - AGENTS.md (pure Markdown)
 *
 * Source: OpenAI Codex Skills documentation.
 */

import matter from '../../utils/frontmatter.js';
import type { RuleFormatAdapter, UnifiedRule, RuleSource } from '../../types.js';
import { hashContent, generateRuleId } from '../utils.js';

export class CodexAdapter implements RuleFormatAdapter {
  readonly source: RuleSource = 'codex';

  readonly filePatterns = [
    '.agents/skills/*/SKILL.md',
    'AGENTS.md',
  ];

  parse(filePath: string, content: string): UnifiedRule[] {
    if (filePath.includes('SKILL.md')) {
      return this.parseSkillMd(filePath, content);
    }
    if (filePath.endsWith('AGENTS.md')) {
      return this.parseAgentsMd(filePath, content);
    }
    return [];
  }

  generate(rules: UnifiedRule[]): { filePath: string; content: string }[] {
    return rules.map((rule, i) => {
      const skillName = rule.id
        .replace(/^codex:/, '')
        .replace(/[^a-zA-Z0-9-_]/g, '-')
        || `skill-${i}`;

      const fm: Record<string, unknown> = {
        name: skillName,
      };

      // Codex needs description to know WHEN to trigger the skill.
      // If no description exists, auto-generate from content (first 120 chars).
      if (rule.description) {
        fm.description = rule.description;
      } else {
        fm.description = this.autoDescription(rule.content);
      }

      return {
        filePath: `.agents/skills/${skillName}/SKILL.md`,
        content: matter.stringify(rule.content, fm),
      };
    });
  }

  /** Extract a short description from rule content for Codex skill triggering */
  private autoDescription(content: string): string {
    // Take first meaningful line, strip markdown formatting
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    const first = lines[0]?.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '') || 'Project rules';
    if (first.length <= 120) return first;
    return first.substring(0, 117) + '...';
  }

  private parseSkillMd(filePath: string, content: string): UnifiedRule[] {
    const { data, content: body } = matter(content);
    const trimmed = body.trim();
    if (!trimmed) return [];

    return [{
      id: generateRuleId('codex', filePath),
      content: trimmed,
      description: (data.description as string) || undefined,
      source: 'codex',
      scope: 'project',
      priority: 5,
      hash: hashContent(trimmed),
    }];
  }

  private parseAgentsMd(filePath: string, content: string): UnifiedRule[] {
    const trimmed = content.trim();
    if (!trimmed) return [];

    return [{
      id: generateRuleId('codex', filePath),
      content: trimmed,
      source: 'codex',
      scope: 'project',
      priority: 5,
      hash: hashContent(trimmed),
    }];
  }
}
