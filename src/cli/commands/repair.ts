/**
 * memorix repair — Safe repair entry points for Memorix-owned integration files.
 */

import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'repair',
    description: 'Repair Memorix-owned agent integration files',
  },
  args: {
    agent: {
      type: 'string',
      description: 'Agent to repair (default: all detected repairable entries)',
    },
    scope: {
      type: 'string',
      description: 'Scope: project, global, or all',
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

    if (action !== 'agents') {
      const message = 'Usage: memorix repair agents [--agent <agent>] [--scope project|global|all] [--dry]';
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
