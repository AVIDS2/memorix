/**
 * CLI Command: memorix hooks install
 *
 * TUI interactive selection for installing hooks.
 * Auto-detects installed agents and lets user choose which to install.
 */

import { defineCommand } from 'citty';
import * as p from '@clack/prompts';

export default defineCommand({
  meta: {
    name: 'install',
    description: 'Install Memorix hooks for IDEs (interactive)',
  },
  args: {
    agent: {
      type: 'string',
      description: 'Target agent (skip TUI selection)',
      required: false,
    },
    global: {
      type: 'boolean',
      description: 'Install globally instead of per-project',
      required: false,
    },
  },
  run: async ({ args }) => {
    const { detectInstalledAgents, installHooks, getHookStatus } = await import('../../hooks/installers/index.js');
    const os = await import('node:os');
    let cwd: string;
    try {
      cwd = process.cwd();
    } catch {
      cwd = os.homedir();
      console.log(`[WARN] Could not access current directory, using home: ${cwd}`);
    }

    // If user specifies agent, install directly (scriptable mode)
    if (args.agent) {
      await installSingleAgent(args.agent, cwd, args.global ?? false);
      return;
    }

    // Otherwise, TUI interactive selection
    const detectedAgents = await detectInstalledAgents();
    if (detectedAgents.length === 0) {
      console.log('No supported agents detected. Use --agent to specify one.');
      return;
    }

    // Check already installed agents
    const statuses = await getHookStatus(cwd);
    const installedAgents = new Set(statuses.filter((s) => s.installed).map((s) => s.agent));

    // Filter out already installed
    const availableAgents = detectedAgents.filter((agent) => !installedAgents.has(agent));

    if (availableAgents.length === 0) {
      console.log('✅ All detected agents already have hooks installed.');
      return;
    }

    // TUI interactive selection
    p.intro('Memorix Hooks Installation');

    const { AGENT_SUPPORT_TIER } = await import('../../hooks/types.js');
    const selected = await p.multiselect({
      message: 'Select IDEs to install Memorix hooks:',
      options: availableAgents.map((agent) => ({
        value: agent,
        label: getAgentLabel(agent),
        hint: getAgentHint(agent) + ` [${AGENT_SUPPORT_TIER[agent as import('../../hooks/types.js').AgentName] ?? 'community'}]`,
      })),
      required: false,
    });

    if (p.isCancel(selected)) {
      p.outro('Installation cancelled.');
      return;
    }

    if (selected.length === 0) {
      p.outro('No agents selected.');
      return;
    }

    // Show files to be created
    p.note(`Will install hooks for: ${selected.join(', ')}`);

    // Confirm
    const confirmed = await p.confirm({
      message: 'Continue installation?',
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.outro('Installation cancelled.');
      return;
    }

    // Install selected agents
    for (const agent of selected) {
      await installSingleAgent(agent, cwd, args.global ?? false);
    }

    p.outro('✅ Hooks installed! Restart your IDE to apply.');
  },
});

async function installSingleAgent(agent: string, cwd: string, global: boolean): Promise<void> {
  const { installHooks } = await import('../../hooks/installers/index.js');
  try {
    const config = await installHooks(
      agent as import('../../hooks/types.js').AgentName,
      cwd,
      global,
    );
    console.log(`✅ ${agent}: hooks installed -> ${config.configPath}`);
    console.log(`   Events: ${config.events.join(', ')}`);

    // Copilot on Windows without pwsh: warn about runtime compatibility
    if (agent === 'copilot' && process.platform === 'win32') {
      try {
        const { execSync } = await import('node:child_process');
        execSync('pwsh --version', { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'ignore'] });
      } catch {
        console.warn(`⚠️  ${agent}: pwsh (PowerShell v7+) not found. Copilot hooks will use the bash field via Git Bash.`);
        console.warn(`   For best Windows support, install PowerShell v7+: winget install Microsoft.PowerShell`);
      }
    }

    // Copilot global not supported
    if (agent === 'copilot' && global) {
      const note = (config.generated as Record<string, unknown>)?.note;
      if (note) console.warn(`⚠️  ${note}`);
    }
  } catch (err) {
    console.error(`❌ ${agent}: failed - ${err}`);
  }
}

function getAgentLabel(agent: string): string {
  const labels: Record<string, string> = {
    claude: 'Claude Code',
    windsurf: 'Windsurf',
    cursor: 'Cursor',
    copilot: 'VS Code Copilot',
    opencode: 'OpenCode',
    kiro: 'Kiro',
    antigravity: 'Antigravity',
    'gemini-cli': 'Gemini CLI',
    trae: 'Trae',
  };
  return labels[agent] || agent;
}

function getAgentHint(agent: string): string {
  const hints: Record<string, string> = {
    claude: '.claude/settings.json',
    windsurf: '.windsurf/hooks.json',
    cursor: '.cursor/hooks.json',
    copilot: '.github/hooks/memorix.json (project-only, no global)',
    opencode: '.opencode/plugins/memorix.js',
    kiro: '.kiro/hooks/memorix-agent-stop.kiro.hook',
    antigravity: '.gemini/settings.json',
    'gemini-cli': '.gemini/settings.json',
    trae: '.trae/rules/project_rules.md (rules only, no hooks system)',
    codex: 'AGENTS.md (rules only, hooks are experimental)',
  };
  return hints[agent] || '';
}
