/**
 * CLI Command: memorix hooks install
 *
 * Auto-detect installed agents and install hook configurations.
 */

import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'install',
    description: 'Install automatic memory hooks for agents',
  },
  args: {
    agent: {
      type: 'string',
      description: 'Target agent (claude|copilot|windsurf|cursor|kiro|codex). Auto-detects if omitted.',
      required: false,
    },
    global: {
      type: 'boolean',
      description: 'Install globally instead of per-project',
      required: false,
    },
  },
  run: async ({ args }) => {
    const { detectInstalledAgents, installHooks } = await import('../../hooks/installers/index.js');
    const os = await import('node:os');
    // process.cwd() can fail with EPERM on macOS if CWD was deleted or is inaccessible
    let cwd: string;
    try {
      cwd = process.cwd();
    } catch {
      cwd = os.homedir();
      console.log(`⚠️ Could not access current directory, using home: ${cwd}`);
    }

    let agents: string[];
    if (args.agent) {
      agents = [args.agent];
    } else {
      agents = await detectInstalledAgents();
      if (agents.length === 0) {
        console.log('No supported agents detected. Use --agent to specify one.');
        return;
      }
      console.log(`Detected agents: ${agents.join(', ')}`);
    }

    for (const agent of agents) {
      try {
        const config = await installHooks(
          agent as import('../../hooks/types.js').AgentName,
          cwd,
          args.global ?? false,
        );
        console.log(`✅ ${agent}: hooks installed → ${config.configPath}`);
        console.log(`   Events: ${config.events.join(', ')}`);
      } catch (err) {
        console.error(`❌ ${agent}: failed — ${err}`);
      }
    }

    console.log('\nMemory hooks are now active. Restart your agent to apply.');
  },
});
