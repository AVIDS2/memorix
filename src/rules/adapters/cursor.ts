/**
 * Cursor Rule Format Adapter
 *
 * Parses and generates rules in Cursor's formats:
 * - .cursor/rules/*.mdc (Markdown + frontmatter with description, alwaysApply, globs)
 * - .cursorrules (legacy plain text)
 * - AGENTS.md (pure Markdown)
 *
 * Source: Cursor official documentation on Project Rules.
 */

import matter from '../../utils/frontmatter.js';
import type { RuleFormatAdapter, UnifiedRule, RuleSource } from '../../types.js';
import { hashContent, generateRuleId } from '../utils.js';

export class CursorAdapter implements RuleFormatAdapter {
  readonly source: RuleSource = 'cursor';

  readonly filePatterns = [
    '.cursor/rules/*.mdc',
    '.cursorrules',
    'AGENTS.md',
  ];

  parse(filePath: string, content: string): UnifiedRule[] {
    if (filePath.endsWith('.mdc')) {
      return this.parseMdc(filePath, content);
    }
    if (filePath === '.cursorrules' || filePath.endsWith('/.cursorrules')) {
      return this.parseLegacy(filePath, content);
    }
    if (filePath.endsWith('AGENTS.md')) {
      return this.parseAgentsMd(filePath, content);
    }
    return [];
  }

  generate(rules: UnifiedRule[]): { filePath: string; content: string }[] {
    return rules.map((rule, i) => {
      const fm: Record<string, unknown> = {};
      if (rule.description) fm.description = rule.description;
      if (rule.alwaysApply !== undefined) fm.alwaysApply = rule.alwaysApply;
      if (rule.paths && rule.paths.length > 0) fm.globs = rule.paths;

      const fileName = rule.id
        .replace(/^cursor:/, '')
        .replace(/[^a-zA-Z0-9-_]/g, '-')
        || `rule-${i}`;

      const body = Object.keys(fm).length > 0
        ? matter.stringify(rule.content, fm)
        : rule.content;

      return {
        filePath: `.cursor/rules/${fileName}.mdc`,
        content: body,
      };
    });
  }

  private parseMdc(filePath: string, content: string): UnifiedRule[] {
    const { data, content: body } = matter(content);
    const trimmed = body.trim();
    if (!trimmed) return [];

    const globs = data.globs as string[] | undefined;
    const hasGlobs = Array.isArray(globs) && globs.length > 0;
    const alwaysApply = data.alwaysApply === true;

    let scope: UnifiedRule['scope'] = 'project';
    if (alwaysApply) scope = 'global';
    else if (hasGlobs) scope = 'path-specific';

    return [{
      id: generateRuleId('cursor', filePath),
      content: trimmed,
      description: data.description as string | undefined,
      source: 'cursor',
      scope,
      paths: hasGlobs ? globs : undefined,
      alwaysApply,
      priority: alwaysApply ? 10 : 5,
      hash: hashContent(trimmed),
    }];
  }

  private parseLegacy(filePath: string, content: string): UnifiedRule[] {
    const trimmed = content.trim();
    if (!trimmed) return [];

    return [{
      id: generateRuleId('cursor', filePath),
      content: trimmed,
      source: 'cursor',
      scope: 'project',
      priority: 3,
      hash: hashContent(trimmed),
    }];
  }

  private parseAgentsMd(filePath: string, content: string): UnifiedRule[] {
    const trimmed = content.trim();
    if (!trimmed) return [];

    return [{
      id: generateRuleId('cursor', filePath),
      content: trimmed,
      source: 'cursor',
      scope: 'project',
      priority: 5,
      hash: hashContent(trimmed),
    }];
  }
}
