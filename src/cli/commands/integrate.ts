/**
 * CLI Command: memorix integrate
 *
 * Explicit, opt-in IDE integration generation.
 * This is the product-facing wrapper around hooks/rules installers.
 */

import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import type { AgentName } from '../../hooks/types.js';
import {
  getIntegrationScopeLabel,
  getIntegrationTargetRoot,
} from './integrate-shared.js';

export default defineCommand({
  meta: {
    name: 'integrate',
    description: 'Generate integration files for a specific IDE or agent',
  },
  args: {
    agent: {
      type: 'string',
      description: 'Target agent (skip interactive selection)',
      required: false,
    },
    global: {
      type: 'boolean',
      description: 'Write integration into global defaults instead of the current project',
      required: false,
    },
  },
  run: async ({ args }) => {
    const { detectInstalledAgents, installHooks } = await import('../../hooks/installers/index.js');

    const targetRoot = getIntegrationTargetRoot(!!args.global, process.cwd());
    const scopeLabel = getIntegrationScopeLabel(!!args.global);

    if (args.agent) {
      await installSingleAgent(installHooks, args.agent, targetRoot, !!args.global);
      return;
    }

    const detectedAgents = await detectInstalledAgents();
    if (detectedAgents.length === 0) {
      p.log.warn('No supported IDEs were auto-detected. Use --agent to install one explicitly.');
      return;
    }

    p.intro('Memorix Integrations');
    p.log.info(`Install only what you need for the ${scopeLabel}.`);

    const selected = await p.multiselect({
      message: 'Which IDE integrations should Memorix generate?',
      options: detectedAgents.map((agent) => ({
        value: agent,
        label: getAgentLabel(agent),
        hint: getAgentHint(agent),
      })),
      required: false,
    });

    if (p.isCancel(selected)) {
      p.outro('Cancelled.');
      return;
    }

    if (selected.length === 0) {
      p.outro('No IDE integrations selected.');
      return;
    }

    const confirmed = await p.confirm({
      message: `Generate ${selected.length} integration(s) for the ${scopeLabel}?`,
      initialValue: true,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.outro('Cancelled.');
      return;
    }

    for (const agent of selected) {
      await installSingleAgent(installHooks, agent, targetRoot, !!args.global);
    }

    p.outro('Done! Restart your IDE or MCP host to pick up the new integration files.');
  },
});

async function installSingleAgent(
  installHooks: (agent: AgentName, projectRoot: string, global?: boolean) => Promise<{ configPath: string }>,
  agent: string,
  targetRoot: string,
  global: boolean,
): Promise<void> {
  try {
    const config = await installHooks(agent as AgentName, targetRoot, global);
    p.log.success(`${getAgentLabel(agent)} -> ${config.configPath}`);
  } catch (error) {
    p.log.error(`${getAgentLabel(agent)} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function getAgentLabel(agent: string): string {
  const labels: Record<string, string> = {
    claude: 'Claude Code',
    windsurf: 'Windsurf',
    cursor: 'Cursor',
    copilot: 'GitHub Copilot',
    opencode: 'OpenCode',
    kiro: 'Kiro',
    codex: 'Codex',
    antigravity: 'Antigravity',
    'gemini-cli': 'Gemini CLI',
    trae: 'Trae',
  };
  return labels[agent] || agent;
}

function getAgentHint(agent: string): string {
  const hints: Record<string, string> = {
    claude: 'settings + instructions',
    windsurf: 'hooks + rules',
    cursor: 'hooks + rules',
    copilot: 'hooks + instructions',
    opencode: 'plugin + AGENTS.md',
    kiro: 'hook files + steering',
    codex: 'AGENTS.md',
    antigravity: 'settings + GEMINI.md',
    'gemini-cli': 'settings + GEMINI.md',
    trae: 'rules',
  };
  return hints[agent] || 'integration files';
}
