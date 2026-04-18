/**
 * CLI Command: memorix hooks status
 *
 * Show hook installation status for all agents.
 * Icons:
 *   [OK]  — installed and verified (config-based agent, file read directly)
 *   [??]  — installed but unverified (plugin-based agent, runtime load not confirmed)
 *   [!!]  — installed but outdated
 *   [ ]   — not installed
 */

import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'status',
    description: 'Show hook installation status for all agents',
  },
  run: async () => {
    const { getHookStatus } = await import('../../hooks/installers/index.js');
    const { AGENT_SUPPORT_TIER } = await import('../../hooks/types.js');
    const os = await import('node:os');
    let cwd: string;
    try { cwd = process.cwd(); } catch { cwd = os.homedir(); }

    const statuses = await getHookStatus(cwd);

    console.log('\nMemorix Hooks Status');
    console.log('═'.repeat(50));

    let hasOutdated = false;
    let hasUnverified = false;
    let hasRuntimeIssue = false;
    for (const { agent, installed, outdated, verified, runtimeReady, configPath } of statuses) {
      const icon = installed
        ? (!runtimeReady ? '[!!]' : (outdated ? '[!!]' : (verified ? '[OK]' : '[??]')))
        : '[ ]';
      const label = agent.charAt(0).toUpperCase() + agent.slice(1);
      const tier = AGENT_SUPPORT_TIER[agent];
      const tierLabel = tier === 'core' ? '★' : tier === 'extended' ? '◆' : '○';
      const suffix = !runtimeReady && installed
        ? ' (installed but runtime NOT ready — missing pwsh on Windows)'
        : outdated
          ? ' (outdated - re-run `memorix hooks install`)'
          : (!verified && installed ? ' (plugin file installed, runtime load unverified)' : '');
      console.log(`${icon} ${tierLabel} ${label.padEnd(12)} ${installed ? configPath + suffix : '(not installed)'}`);
      if (outdated) hasOutdated = true;
      if (!verified && installed) hasUnverified = true;
      if (!runtimeReady && installed) hasRuntimeIssue = true;
    }

    console.log('\nSupport tiers: ★ core | ◆ extended | ○ community');

    if (hasOutdated) {
      console.log('\n[warn] Outdated hooks detected. Run `memorix hooks install` to update.');
    }
    if (hasUnverified) {
      console.log('\n[info] [??] = plugin file installed but runtime load unverified.');
      console.log('       For OpenCode: verify by running `opencode --log-level DEBUG` and checking');
      console.log('       for [memorix-plugin] messages in the log output.');
    }
    if (hasRuntimeIssue) {
      console.log('\n[warn] [!!] = installed but runtime will fail.');
      console.log('       Copilot on Windows requires PowerShell v6+ (pwsh.exe) for hook execution.');
      console.log('       Install pwsh: https://learn.microsoft.com/powershell/scripting/install/installing-powershell');
      console.log('       Without pwsh, Copilot hooks will fail at runtime with "spawn pwsh.exe ENOENT".');
    }

    console.log('\nRun `memorix hooks install` to set up hooks for detected agents.');
  },
});
