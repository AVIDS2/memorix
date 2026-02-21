/**
 * memorix sync — Interactive cross-agent rule sync
 *
 * Uses @clack/prompts for a beautiful interactive wizard.
 */

import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import type { RuleSource } from '../../types.js';

const SOURCE_LABELS: Record<string, string> = {
  cursor: 'Cursor (.cursor/rules/*.mdc, .cursorrules)',
  'claude-code': 'Claude Code (CLAUDE.md, .claude/rules/*.md)',
  codex: 'Codex (SKILL.md, AGENTS.md)',
  windsurf: 'Windsurf (.windsurfrules, .windsurf/rules/*.md)',
  antigravity: 'Antigravity (.agent/rules/*.md, GEMINI.md)',
  kiro: 'Kiro (.kiro/steering/*.md, AGENTS.md)',
};

export default defineCommand({
  meta: {
    name: 'sync',
    description: 'Interactive cross-agent rule synchronization',
  },
  args: {
    target: {
      type: 'string',
      description: 'Target agent format (cursor, claude-code, codex, windsurf, antigravity, kiro)',
      required: false,
    },
    dry: {
      type: 'boolean',
      description: 'Dry run — show what would be generated without writing files',
      default: false,
    },
  },
  run: async ({ args }) => {
    const { detectProject } = await import('../../project/detector.js');
    const { RulesSyncer } = await import('../../rules/syncer.js');
    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');

    p.intro('memorix sync');

    // Detect project
    const project = detectProject();
    p.log.info(`Project: ${project.name} (${project.id})`);

    // Scan rules
    const syncer = new RulesSyncer(project.rootPath);
    const spin = p.spinner();
    spin.start('Scanning rule files...');
    const rules = await syncer.scanRules();
    spin.stop(`Found ${rules.length} rule(s)`);

    if (rules.length === 0) {
      p.log.warn('No rule files found in this project.');
      p.log.info('Create .cursorrules, CLAUDE.md, or .windsurfrules to get started.');
      p.outro('Nothing to sync');
      return;
    }

    // Show sources
    const sources = [...new Set(rules.map(r => r.source))];
    p.log.info(`Sources: ${sources.map(s => SOURCE_LABELS[s] || s).join(', ')}`);

    // Dedup
    const deduped = syncer.deduplicateRules(rules);
    if (deduped.length < rules.length) {
      p.log.info(`Deduplicated: ${rules.length} → ${deduped.length} unique rule(s)`);
    }

    // Conflicts
    const conflicts = syncer.detectConflicts(deduped);
    if (conflicts.length > 0) {
      p.log.warn(`⚠ ${conflicts.length} conflict(s) detected:`);
      for (const c of conflicts) {
        p.log.warn(`  ${c.ruleA.source} vs ${c.ruleB.source}: ${c.reason}`);
      }
    }

    // Select target
    let target = args.target as RuleSource | undefined;

    if (!target) {
      const available = ['cursor', 'claude-code', 'codex', 'windsurf', 'antigravity', 'kiro'].filter(
        t => !sources.includes(t as RuleSource),
      );

      if (available.length === 0) {
        // All formats already present, let user pick any
        available.push('cursor', 'claude-code', 'codex', 'windsurf', 'antigravity', 'kiro');
      }

      const selected = await p.select({
        message: 'Generate rules for which agent?',
        options: available.map(t => ({
          value: t,
          label: SOURCE_LABELS[t] || t,
        })),
      });

      if (p.isCancel(selected)) {
        p.cancel('Sync cancelled');
        process.exit(0);
      }

      target = selected as RuleSource;
    }

    // Generate
    spin.start(`Generating ${target} rules...`);
    const files = syncer.generateForTarget(deduped, target);
    spin.stop(`Generated ${files.length} file(s)`);

    // Show preview
    for (const file of files) {
      p.note(file.content, file.filePath);
    }

    // Write or dry run
    if (args.dry) {
      p.log.info('Dry run — no files written');
      p.outro('Done (dry run)');
      return;
    }

    const confirm = await p.confirm({
      message: `Write ${files.length} file(s) to project?`,
    });

    if (p.isCancel(confirm) || !confirm) {
      p.cancel('Sync cancelled');
      process.exit(0);
    }

    for (const file of files) {
      const fullPath = path.join(project.rootPath, file.filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, file.content, 'utf-8');
      p.log.success(`Written: ${file.filePath}`);
    }

    p.outro(`Synced ${files.length} rule(s) to ${target} format`);
  },
});
