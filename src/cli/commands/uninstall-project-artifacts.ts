/**
 * CLI Command: memorix uninstall project-artifacts
 *
 * Uninstall project-level hook files only (preserve memory data).
 */

import { defineCommand } from 'citty';
import * as p from '@clack/prompts';

export default defineCommand({
  meta: {
    name: 'project-artifacts',
    description: 'Uninstall project hook files (preserve memory data)',
  },
  args: {
    agent: {
      type: 'string',
      description: 'Target agent (all if omitted)',
      required: false,
    },
  },
  run: async ({ args }) => {
    const { detectInstalledAgents, uninstallHooks } = await import('../../hooks/installers/index.js');
    const os = await import('node:os');
    let cwd: string;
    try { cwd = process.cwd(); } catch { cwd = os.homedir(); }

    p.intro('Uninstall Project Artifacts');

    let agents: string[];
    if (args.agent) {
      agents = [args.agent];
    } else {
      agents = await detectInstalledAgents();
    }

    if (agents.length === 0) {
      console.log('No supported agents detected.');
      return;
    }

    // Show what will be uninstalled
    console.log('');
    console.log('Will uninstall hooks for:');
    for (const agent of agents) {
      console.log(`  - ${agent}`);
    }
    console.log('');
    console.log('This will remove hook files from the project:');
    console.log('  - .claude/settings.local.json');
    console.log('  - .windsurf/hooks.json');
    console.log('  - .cursor/hooks.json');
    console.log('  - .github/hooks/memorix.json');
    console.log('  - .cursor/rules/memorix.mdc');
    console.log('  - etc.');
    console.log('');
    console.log('Memory data will be preserved.');
    console.log('');

    // Confirm
    const confirmed = await p.confirm({
      message: 'Continue uninstall?',
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.outro('Uninstall cancelled.');
      return;
    }

    // Uninstall
    for (const agent of agents) {
      const ok = await uninstallHooks(
        agent as import('../../hooks/types.js').AgentName,
        cwd,
        false, // project-level
      );
      if (ok) {
        console.log(`✅ ${agent}: hooks removed`);
      } else {
        console.log(`⏭️ ${agent}: no hooks found`);
      }
    }

    p.outro('Project artifacts uninstalled. Memory data preserved.');
  },
});
