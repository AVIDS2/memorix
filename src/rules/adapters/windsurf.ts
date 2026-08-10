/**
 * Windsurf Rule Format Adapter
 *
 * Parses and generates rules in Windsurf's formats:
 * - .windsurfrules (legacy plain text)
 * - .windsurf/rules/*.md (Markdown with optional frontmatter)
 *
 * Source: Windsurf/Codeium documentation.
 */

import matter from '../../utils/frontmatter.js';
import type { RuleFormatAdapter, UnifiedRule, RuleSource } from '../../types.js';
import { hashContent, generateRuleId } from '../utils.js';

export class WindsurfAdapter implements RuleFormatAdapter {
  readonly source: RuleSource = 'windsurf';

  readonly filePatterns = [
    '.windsurfrules',
    '.windsurf/rules/*.md',
  ];

  parse(filePath: string, content: string): UnifiedRule[] {
    if (filePath === '.windsurfrules' || filePath.endsWith('/.windsurfrules')) {
      return this.parseLegacy(filePath, content);
    }
    if (filePath.includes('.windsurf/rules/')) {
      return this.parseModularRule(filePath, content);
    }
    return [];
  }

  generate(rules: UnifiedRule[]): { filePath: string; content: string }[] {
    return rules.map((rule, i) => {
      const fm: Record<string, unknown> = {};
      if (rule.description) fm.description = rule.description;

      const fileName = rule.id
        .replace(/^windsurf:/, '')
        .replace(/[^a-zA-Z0-9-_]/g, '-')
        || `rule-${i}`;

      const body = Object.keys(fm).length > 0
        ? matter.stringify(rule.content, fm)
        : rule.content;

      return {
        filePath: `.windsurf/rules/${fileName}.md`,
        content: body,
      };
    });
  }

  private parseLegacy(filePath: string, content: string): UnifiedRule[] {
    const trimmed = content.trim();
    if (!trimmed) return [];

    return [{
      id: generateRuleId('windsurf', filePath),
      content: trimmed,
      source: 'windsurf',
      scope: 'project',
      priority: 3,
      hash: hashContent(trimmed),
    }];
  }

  private parseModularRule(filePath: string, content: string): UnifiedRule[] {
    const { data, content: body } = matter(content);
    const trimmed = body.trim();
    if (!trimmed) return [];

    return [{
      id: generateRuleId('windsurf', filePath),
      content: trimmed,
      description: data.description as string | undefined,
      source: 'windsurf',
      scope: 'project',
      priority: 5,
      hash: hashContent(trimmed),
    }];
  }
}
