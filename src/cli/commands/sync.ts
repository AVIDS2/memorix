/**
 * memorix sync — interactive sync wizard plus explicit rules/workspace surfaces
 */

import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import type { AgentTarget, RuleSource } from '../../types.js';
import { emitError, emitResult, getCliProjectContext } from './operator-shared.js';

const SOURCE_LABELS: Record<string, string> = {
  cursor: 'Cursor (.cursor/rules/*.mdc, .cursorrules)',
  'claude-code': 'Claude Code (CLAUDE.md, .claude/rules/*.md)',
  codex: 'Codex (SKILL.md, AGENTS.md)',
  windsurf: 'Windsurf (.windsurfrules, .windsurf/rules/*.md)',
  antigravity: 'Antigravity (.agent/rules/*.md, GEMINI.md)',
  'gemini-cli': 'Gemini CLI (.gemini/rules/*.md, GEMINI.md)',
  kiro: 'Kiro (.kiro/steering/*.md, AGENTS.md)',
};

export default defineCommand({
  meta: {
    name: 'sync',
    description: 'Interactive cross-agent synchronization plus explicit rules/workspace subcommands',
  },
  args: {
    action: {
      type: 'string',
      description: 'Explicit action for rules/workspace sync',
      required: false,
    },
    target: {
      type: 'string',
      description: 'Target agent format (cursor, claude-code, codex, windsurf, antigravity, gemini-cli, kiro)',
      required: false,
    },
    items: {
      type: 'string',
      description: 'Comma-separated item names for workspace sync filtering',
      required: false,
    },
    dry: {
      type: 'boolean',
      description: 'Dry run — show what would be generated without writing files',
      default: false,
    },
    json: {
      type: 'boolean',
      description: 'Emit machine-readable JSON output',
      default: false,
    },
  },
  run: async ({ args }) => {
    const section = (args._ as string[])?.[0] || '';
    const asJson = !!args.json;

    if (section === 'rules' || section === 'workspace') {
      try {
        const { project } = await getCliProjectContext();

        if (section === 'rules') {
          const { RulesSyncer } = await import('../../rules/syncer.js');
          const syncer = new RulesSyncer(project.rootPath);
          const action = (args.action as string | undefined) || 'status';

          if (action === 'status') {
            const status = await syncer.syncStatus();
            emitResult(
              { project, status },
              [
                'Rules Sync Status',
                `- Sources found: ${status.sources.join(', ') || 'none'}`,
                `- Total rules: ${status.totalRules}`,
                `- Unique rules: ${status.uniqueRules}`,
                `- Conflicts: ${status.conflicts.length}`,
              ].join('\n'),
              asJson,
            );
            return;
          }

          if (action === 'generate') {
            const rawTarget = args.target as string | undefined;
            if (!rawTarget) {
              emitError('target is required for "memorix sync rules --action generate"', asJson);
              return;
            }
            const rules = await syncer.scanRules();
            const effectiveTarget = (rawTarget === 'opencode' ? 'codex' : rawTarget) as RuleSource;
            const files = syncer.generateForTarget(syncer.deduplicateRules(rules), effectiveTarget);
            emitResult(
              { project, target: rawTarget, files },
              files.length === 0 ? 'No rules generated.' : files.map((file) => `- ${file.filePath}`).join('\n'),
              asJson,
            );
            return;
          }

          emitError('action must be status or generate for "memorix sync rules"', asJson);
          return;
        }

        const { WorkspaceSyncEngine } = await import('../../workspace/engine.js');
        const engine = new WorkspaceSyncEngine(project.rootPath);
        const action = (args.action as string | undefined) || 'scan';
        const items = args.items
          ? String(args.items).split(',').map((item) => item.trim()).filter(Boolean)
          : undefined;

        if (action === 'scan') {
          const scan = await engine.scan();
          emitResult(
            { project, scan },
            [
              'Workspace Scan Report',
              `- MCP configs: ${Object.values(scan.mcpConfigs).reduce((sum, servers) => sum + servers.length, 0)}`,
              `- Workflows: ${scan.workflows.length}`,
              `- Rules: ${scan.rulesCount}`,
              `- Skills: ${scan.skills.length}`,
            ].join('\n'),
            asJson,
          );
          return;
        }

        const target = args.target as AgentTarget | undefined;
        if (!target) {
          emitError('target is required for "memorix sync workspace" migrate/apply actions', asJson);
          return;
        }

        if (action === 'migrate') {
          const result = await engine.migrate(target, items);
          emitResult({ project, target, result }, `Workspace migration preview for ${target}`, asJson);
          return;
        }

        if (action === 'apply') {
          const result = await engine.apply(target, items);
          emitResult({ project, target, result }, result.migrationSummary, asJson);
          return;
        }

        emitError('action must be scan, migrate, or apply for "memorix sync workspace"', asJson);
        return;
      } catch (error) {
        emitError(error instanceof Error ? error.message : String(error), asJson);
        return;
      }
    }

    const { detectProject } = await import('../../project/detector.js');
    const { RulesSyncer } = await import('../../rules/syncer.js');
    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');

    p.intro('memorix sync');

    const project = detectProject();
    if (!project) {
      p.log.error('Memorix requires a git repo to establish project identity. Run `git init` in this workspace first.');
      return;
    }
    p.log.info(`Project: ${project.name} (${project.id})`);

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

    const sources = [...new Set(rules.map((rule) => rule.source))];
    p.log.info(`Sources: ${sources.map((source) => SOURCE_LABELS[source] || source).join(', ')}`);

    const deduped = syncer.deduplicateRules(rules);
    if (deduped.length < rules.length) {
      p.log.info(`Deduplicated: ${rules.length} → ${deduped.length} unique rule(s)`);
    }

    const conflicts = syncer.detectConflicts(deduped);
    if (conflicts.length > 0) {
      p.log.warn(`⚠ ${conflicts.length} conflict(s) detected:`);
      for (const conflict of conflicts) {
        p.log.warn(`  ${conflict.ruleA.source} vs ${conflict.ruleB.source}: ${conflict.reason}`);
      }
    }

    let target = args.target as RuleSource | undefined;
    if (!target) {
      const available = ['cursor', 'claude-code', 'codex', 'windsurf', 'antigravity', 'gemini-cli', 'kiro'].filter(
        (value) => !sources.includes(value as RuleSource),
      );

      if (available.length === 0) {
        available.push('cursor', 'claude-code', 'codex', 'windsurf', 'antigravity', 'gemini-cli', 'kiro');
      }

      const selected = await p.select({
        message: 'Generate rules for which agent?',
        options: available.map((value) => ({
          value,
          label: SOURCE_LABELS[value] || value,
        })),
      });

      if (p.isCancel(selected)) {
        p.cancel('Sync cancelled');
        process.exit(0);
      }

      target = selected as RuleSource;
    }

    spin.start(`Generating ${target} rules...`);
    const files = syncer.generateForTarget(deduped, target);
    spin.stop(`Generated ${files.length} file(s)`);

    for (const file of files) {
      p.note(file.content, file.filePath);
    }

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
