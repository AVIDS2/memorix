/**
 * CLI Command: memorix hooks status
 *
 * Show hook installation status for all agents.
 */

import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'status',
    description: 'Show hook installation status for all agents',
  },
  run: async () => {
    const { getHookStatus } = await import('../../hooks/installers/index.js');
    const os = await import('node:os');
    let cwd: string;
    try { cwd = process.cwd(); } catch { cwd = os.homedir(); }

    const statuses = await getHookStatus(cwd);

    console.log('\nMemorix Hooks Status');
    console.log('═'.repeat(50));

    for (const { agent, installed, configPath } of statuses) {
      const icon = installed ? '✅' : '⬚';
      const label = agent.charAt(0).toUpperCase() + agent.slice(1);
      console.log(`${icon} ${label.padEnd(12)} ${installed ? configPath : '(not installed)'}`);
    }

    console.log('\nRun `memorix hooks install` to set up hooks for detected agents.');
  },
});
