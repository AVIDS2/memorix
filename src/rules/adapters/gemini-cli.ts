/**
 * Gemini CLI Rule Format Adapter
 *
 * Parses and generates rules for Google's standalone Gemini CLI tool.
 *
 * Gemini CLI reads context/rules from:
 * - GEMINI.md (project-level context file, shared with Antigravity)
 * - .gemini/rules/*.md (workspace rules, Gemini CLI specific path)
 *
 * Distinction from Antigravity:
 * - Antigravity uses `.agent/rules/*.md` for workspace rules
 * - Gemini CLI uses `.gemini/rules/*.md` for workspace rules
 * - Both share `GEMINI.md` as the top-level context file
 *
 * Source: https://googlegemini.wiki/gemini-cli/configuration
 */

import matter from 'gray-matter';
import type { RuleFormatAdapter, UnifiedRule, RuleSource } from '../../types.js';
import { hashContent, generateRuleId } from '../utils.js';

export class GeminiCLIAdapter implements RuleFormatAdapter {
  readonly source: RuleSource = 'gemini-cli';

  readonly filePatterns = [
    'GEMINI.md',
    '.gemini/rules/*.md',
  ];

  parse(filePath: string, content: string): UnifiedRule[] {
    // .gemini/rules/*.md — workspace rules
    if (filePath.includes('.gemini/rules/')) {
      return this.parseGeminiRule(filePath, content);
    }
    // GEMINI.md — global project-level context
    if (filePath === 'GEMINI.md' || filePath.endsWith('/GEMINI.md')) {
      return this.parseGeminiMd(filePath, content);
    }
    return [];
  }

  generate(rules: UnifiedRule[]): { filePath: string; content: string }[] {
    const files: { filePath: string; content: string }[] = [];

    for (const rule of rules) {
      const fm: Record<string, unknown> = {};
      if (rule.description) fm.description = rule.description;

      const fileName = rule.id
        .replace(/^gemini-cli:/, '')
        .replace(/[^a-zA-Z0-9-_]/g, '-')
        || 'rule';

      const body = Object.keys(fm).length > 0
        ? matter.stringify(rule.content, fm)
        : rule.content;

      files.push({
        filePath: `.gemini/rules/${fileName}.md`,
        content: body,
      });
    }

    return files;
  }

  private parseGeminiMd(filePath: string, content: string): UnifiedRule[] {
    const trimmed = content.trim();
    if (!trimmed) return [];

    return [{
      id: generateRuleId('gemini-cli', filePath),
      content: trimmed,
      source: 'gemini-cli',
      scope: 'global',
      priority: 10,
      hash: hashContent(trimmed),
    }];
  }

  private parseGeminiRule(filePath: string, content: string): UnifiedRule[] {
    const { data, content: body } = matter(content);
    const trimmed = body.trim();
    if (!trimmed) return [];

    return [{
      id: generateRuleId('gemini-cli', filePath),
      content: trimmed,
      description: data.description as string | undefined,
      source: 'gemini-cli',
      scope: 'project',
      priority: 5,
      hash: hashContent(trimmed),
    }];
  }
}
