/**
 * memorix repair — Repair agent integrations and derived indexes.
 */

import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'repair',
    description: 'Repair agent integrations or compact the semantic index',
  },
  args: {
    agent: {
      type: 'string',
      description: 'Agent to repair (default: all detected repairable entries)',
    },
    scope: {
      type: 'string',
      description: 'Scope: local, project, global, or all',
    },
    dry: {
      type: 'boolean',
      description: 'Show what would be repaired without writing files',
      default: false,
    },
    json: {
      type: 'boolean',
      description: 'Emit machine-readable JSON output',
      default: false,
    },
  },
  run: async ({ args }) => {
    const positional = (args._ as string[]) ?? [];
    const action = positional[0] || 'agents';

    if (action === 'index') {
      if (args.dry) throw new Error('`memorix repair index` does not support --dry');
      const { detectProject } = await import('../../project/detector.js');
      const { getProjectDataDir } = await import('../../store/persistence.js');
      const { optimizeSemanticIndexes } = await import('../../search/semantic-index.js');
      const project = detectProject(process.cwd());
      if (!project) throw new Error('Run `memorix repair index` inside a Git project');
      const dataDir = await getProjectDataDir(project.id);
      const tables = await optimizeSemanticIndexes(dataDir);
      if (args.json) console.log(JSON.stringify({ dataDir, optimizedTables: tables }, null, 2));
      else console.log(`Optimized ${tables.length} semantic table(s) in ${dataDir}`);
      return;
    }

    if (action !== 'agents') {
      const message = 'Usage: memorix repair agents [--agent <agent>] [--scope local|project|global|all] [--dry] | memorix repair index [--json]';
      if (args.json) {
        console.log(JSON.stringify({ error: message }, null, 2));
      } else {
        console.log(message);
      }
      process.exitCode = 1;
      return;
    }

    const { repairAgentIntegrations, formatAgentRepairResult } = await import('./agent-integrations.js');
    const repair = await repairAgentIntegrations({
      agent: args.agent as string | undefined,
      scope: args.scope as string | undefined,
      dry: !!args.dry,
    });

    if (args.json) {
      console.log(JSON.stringify({ repair }, null, 2));
    } else {
      console.log(formatAgentRepairResult(repair));
    }
  },
});
