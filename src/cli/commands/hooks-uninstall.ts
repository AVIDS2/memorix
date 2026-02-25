/**
 * CLI Command: memorix hooks uninstall
 *
 * Remove hook configurations for agents.
 */

import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'uninstall',
    description: 'Remove automatic memory hooks for agents',
  },
  args: {
    agent: {
      type: 'string',
      description: 'Target agent (claude|copilot|windsurf|cursor|kiro|codex)',
      required: false,
    },
    global: {
      type: 'boolean',
      description: 'Uninstall global hooks',
      required: false,
    },
  },
  run: async ({ args }) => {
    const { detectInstalledAgents, uninstallHooks } = await import('../../hooks/installers/index.js');
    const os = await import('node:os');
    let cwd: string;
    try { cwd = process.cwd(); } catch { cwd = os.homedir(); }

    let agents: string[];
    if (args.agent) {
      agents = [args.agent];
    } else {
      agents = await detectInstalledAgents();
    }

    for (const agent of agents) {
      const ok = await uninstallHooks(
        agent as import('../../hooks/types.js').AgentName,
        cwd,
        args.global ?? false,
      );
      if (ok) {
        console.log(`✅ ${agent}: hooks removed`);
      } else {
        console.log(`⚠️  ${agent}: no hooks found`);
      }
    }
  },
});
