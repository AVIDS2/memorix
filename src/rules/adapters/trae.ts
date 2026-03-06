/**
 * Trae IDE Rule Format Adapter
 *
 * Parses and generates rules in Trae's format:
 * - .trae/rules/project_rules.md (project-level rules, plain Markdown)
 *
 * Trae also supports user-level rules (user_rules.md) created via the UI,
 * but those are managed by Trae itself and not project-scoped.
 *
 * Rules are plain Markdown — no frontmatter, no special syntax.
 * Project rules override personal rules when there are conflicts.
 *
 * Source: https://docs.trae.ai/ide/rules
 */

import type { RuleFormatAdapter, UnifiedRule, RuleSource } from '../../types.js';
import { hashContent, generateRuleId } from '../utils.js';

export class TraeAdapter implements RuleFormatAdapter {
    readonly source: RuleSource = 'trae';

    readonly filePatterns = [
        '.trae/rules/project_rules.md',
        '.trae/rules/*.md',
    ];

    parse(filePath: string, content: string): UnifiedRule[] {
        const trimmed = content.trim();
        if (!trimmed) return [];

        const isProjectRules = filePath.includes('project_rules.md');

        return [{
            id: generateRuleId('trae', filePath),
            content: trimmed,
            description: isProjectRules ? 'Trae project rules' : undefined,
            source: 'trae',
            scope: 'project',
            alwaysApply: true,
            priority: isProjectRules ? 10 : 5,
            hash: hashContent(trimmed),
        }];
    }

    generate(rules: UnifiedRule[]): { filePath: string; content: string }[] {
        if (rules.length === 0) return [];

        // Trae uses a single project_rules.md file — merge all rules into one
        const combined = rules.map(r => r.content).join('\n\n---\n\n');

        return [{
            filePath: '.trae/rules/project_rules.md',
            content: combined,
        }];
    }
}
