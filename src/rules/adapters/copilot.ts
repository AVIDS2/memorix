/**
 * GitHub Copilot Rule Format Adapter
 *
 * Parses and generates rules in Copilot's formats:
 * - .github/copilot-instructions.md  (repository-wide instructions, plain Markdown)
 * - .github/instructions/*.instructions.md (path-specific, YAML frontmatter with `applyTo` glob)
 *
 * Source: https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot
 */

import matter from '../../utils/frontmatter.js';
import type { RuleFormatAdapter, UnifiedRule, RuleSource } from '../../types.js';
import { hashContent, generateRuleId } from '../utils.js';

export class CopilotAdapter implements RuleFormatAdapter {
    readonly source: RuleSource = 'copilot';

    readonly filePatterns = [
        '.github/copilot-instructions.md',
        '.github/instructions/*.instructions.md',
    ];

    parse(filePath: string, content: string): UnifiedRule[] {
        // Path-specific instruction files (.github/instructions/*.instructions.md)
        if (filePath.includes('.instructions.md') && filePath.includes('.github/instructions')) {
            return this.parsePathSpecific(filePath, content);
        }
        // Repository-wide instructions (.github/copilot-instructions.md)
        if (filePath.includes('copilot-instructions.md')) {
            return this.parseRepoWide(filePath, content);
        }
        return [];
    }

    generate(rules: UnifiedRule[]): { filePath: string; content: string }[] {
        // If only one rule with no path-specific globs, output as copilot-instructions.md
        if (rules.length === 1 && (!rules[0].paths || rules[0].paths.length === 0)) {
            return [{
                filePath: '.github/copilot-instructions.md',
                content: rules[0].content,
            }];
        }

        // Multiple rules → output as path-specific instruction files
        return rules.map((rule, i) => {
            const fm: Record<string, unknown> = {};

            // Preserve applyTo if available
            if (rule.paths && rule.paths.length > 0) {
                fm.applyTo = rule.paths.join(',');
            }
            if (rule.description) {
                fm.description = rule.description;
            }

            const fileName = rule.id
                .replace(/^copilot:/, '')
                .replace(/[^a-zA-Z0-9-_]/g, '-')
                || `instruction-${i}`;

            const body = Object.keys(fm).length > 0
                ? matter.stringify(rule.content, fm)
                : rule.content;

            return {
                filePath: `.github/instructions/${fileName}.instructions.md`,
                content: body,
            };
        });
    }

    /**
     * Parse repository-wide .github/copilot-instructions.md
     * This is plain Markdown with no frontmatter.
     */
    private parseRepoWide(filePath: string, content: string): UnifiedRule[] {
        const trimmed = content.trim();
        if (!trimmed) return [];

        return [{
            id: generateRuleId('copilot', filePath),
            content: trimmed,
            description: 'Repository-wide Copilot instructions',
            source: 'copilot',
            scope: 'project',
            priority: 3,
            hash: hashContent(trimmed),
        }];
    }

    /**
     * Parse path-specific .github/instructions/*.instructions.md
     * These have YAML frontmatter with `applyTo` glob pattern(s).
     */
    private parsePathSpecific(filePath: string, content: string): UnifiedRule[] {
        const { data, content: body } = matter(content);
        const trimmed = body.trim();
        if (!trimmed) return [];

        const applyTo = data.applyTo as string | undefined;
        const hasApplyTo = !!applyTo;

        const rule: UnifiedRule = {
            id: generateRuleId('copilot', filePath),
            content: trimmed,
            source: 'copilot',
            scope: hasApplyTo ? 'path-specific' : 'project',
            priority: 5,
            hash: hashContent(trimmed),
        };

        // Extract applyTo glob pattern(s) → store in paths[]
        if (hasApplyTo) {
            rule.paths = applyTo!.split(',').map(p => p.trim());
        }

        // Extract description if present
        if (data.description) {
            rule.description = data.description as string;
        }

        return [rule];
    }
}
