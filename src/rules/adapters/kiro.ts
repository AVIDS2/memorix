/**
 * Kiro Rule Format Adapter
 *
 * Parses and generates rules in Kiro's formats:
 * - .kiro/steering/*.md (Markdown steering rules with optional frontmatter)
 * - AGENTS.md (always included, pure Markdown)
 *
 * Source: Kiro official documentation on Steering Rules.
 * https://kiro.dev/docs/steering/
 *
 * Kiro uses ".kiro/steering/" for project-level rules
 * and "~/.kiro/steering/" for user-level (global) rules.
 *
 * Frontmatter inclusion modes:
 *   - always (default): loaded into every interaction
 *   - fileMatch + fileMatchPattern: conditional on file globs
 *   - manual: on-demand via #name in chat
 *   - auto + name + description: auto-included when relevant
 */

import matter from 'gray-matter';
import type { RuleFormatAdapter, UnifiedRule, RuleSource } from '../../types.js';
import { hashContent, generateRuleId } from '../utils.js';

/** Kiro inclusion mode values */
type KiroInclusion = 'always' | 'fileMatch' | 'manual' | 'auto';

export class KiroAdapter implements RuleFormatAdapter {
    readonly source: RuleSource = 'kiro';

    readonly filePatterns = [
        '.kiro/steering/*.md',
        'AGENTS.md',
    ];

    parse(filePath: string, content: string): UnifiedRule[] {
        if (filePath.includes('.kiro/steering/')) {
            return this.parseSteeringRule(filePath, content);
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

            // Map unified scope → Kiro inclusion mode
            if (rule.paths && rule.paths.length > 0) {
                fm.inclusion = 'fileMatch';
                fm.fileMatchPattern = rule.paths.length === 1
                    ? rule.paths[0]
                    : rule.paths;
            } else if (rule.alwaysApply) {
                fm.inclusion = 'always';
            }

            const fileName = rule.id
                .replace(/^kiro:/, '')
                .replace(/[^a-zA-Z0-9-_]/g, '-')
                || `rule-${i}`;

            const body = Object.keys(fm).length > 0
                ? matter.stringify(rule.content, fm)
                : rule.content;

            return {
                filePath: `.kiro/steering/${fileName}.md`,
                content: body,
            };
        });
    }

    private parseSteeringRule(filePath: string, content: string): UnifiedRule[] {
        const { data, content: body } = matter(content);
        const trimmed = body.trim();
        if (!trimmed) return [];

        // Kiro uses "inclusion" field: always | fileMatch | manual | auto
        const inclusion = (data.inclusion as KiroInclusion | undefined) ?? 'always';
        const alwaysApply = inclusion === 'always' || inclusion === 'auto';

        // fileMatchPattern can be a string or string[]
        let paths: string[] | undefined;
        if (inclusion === 'fileMatch' && data.fileMatchPattern) {
            paths = Array.isArray(data.fileMatchPattern)
                ? data.fileMatchPattern
                : [data.fileMatchPattern];
        }

        let scope: UnifiedRule['scope'] = 'project';
        if (alwaysApply) scope = 'global';
        else if (paths && paths.length > 0) scope = 'path-specific';

        return [{
            id: generateRuleId('kiro', filePath),
            content: trimmed,
            description: data.description as string | undefined,
            source: 'kiro',
            scope,
            paths,
            alwaysApply,
            priority: alwaysApply ? 10 : 5,
            hash: hashContent(trimmed),
        }];
    }

    private parseAgentsMd(filePath: string, content: string): UnifiedRule[] {
        const trimmed = content.trim();
        if (!trimmed) return [];

        return [{
            id: generateRuleId('kiro', filePath),
            content: trimmed,
            source: 'kiro',
            scope: 'project',
            alwaysApply: true,
            priority: 10,
            hash: hashContent(trimmed),
        }];
    }
}

