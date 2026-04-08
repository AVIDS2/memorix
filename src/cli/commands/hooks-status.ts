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

    let hasOutdated = false;
    for (const { agent, installed, outdated, configPath } of statuses) {
      const icon = installed ? (outdated ? '[!!]' : '[OK]') : '[ ]';
      const label = agent.charAt(0).toUpperCase() + agent.slice(1);
      const suffix = outdated ? ' (outdated - re-run `memorix hooks install`)' : '';
      console.log(`${icon} ${label.padEnd(12)} ${installed ? configPath + suffix : '(not installed)'}`);
      if (outdated) hasOutdated = true;
    }

    if (hasOutdated) {
      console.log('\n[warn] Outdated hooks detected. Run `memorix hooks install` to update.');
    }

    console.log('\nRun `memorix hooks install` to set up hooks for detected agents.');
  },
});
