/**
 * CLI Command: memorix hooks preview
 *
 * Preview which files will be created/modified by hooks installation.
 */

import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export default defineCommand({
  meta: {
    name: 'preview',
    description: 'Preview files to be created by hooks installation',
  },
  args: {
    agent: {
      type: 'string',
      description: 'Target agent (preview all if omitted)',
      required: false,
    },
    global: {
      type: 'boolean',
      description: 'Preview global installation instead of per-project',
      required: false,
    },
  },
  run: async ({ args }) => {
    const { detectInstalledAgents, getProjectConfigPath, getGlobalConfigPath } = await import('../../hooks/installers/index.js');
    const os = await import('node:os');
    let cwd: string;
    try {
      cwd = process.cwd();
    } catch {
      cwd = os.homedir();
      console.log(`[WARN] Could not access current directory, using home: ${cwd}`);
    }

    const global = args.global ?? false;

    // Get agents to preview
    let agents: string[];
    if (args.agent) {
      agents = [args.agent];
    } else {
      agents = await detectInstalledAgents();
      if (agents.length === 0) {
        console.log('No supported agents detected. Use --agent to specify one.');
        return;
      }
    }

    p.intro('Memorix Hooks Preview');

    const previewItems: Array<{
      agent: string;
      path: string;
      action: 'create' | 'modify';
      size: string;
    }> = [];

    for (const agent of agents) {
      const configPath = global
        ? getGlobalConfigPath(agent as import('../../hooks/types.js').AgentName)
        : getProjectConfigPath(agent as import('../../hooks/types.js').AgentName, cwd);

      // Check if file exists
      let action: 'create' | 'modify';
      try {
        await fs.access(configPath);
        action = 'modify';
      } catch {
        action = 'create';
      }

      // Estimate file size (based on agent type)
      const estimatedSize = estimateFileSize(agent, configPath);

      previewItems.push({
        agent,
        path: configPath,
        action,
        size: estimatedSize,
      });

      // Check for rules file (for some agents)
      if (['cursor', 'codex', 'opencode', 'antigravity', 'trae'].includes(agent)) {
        const rulesPath = getRulesPath(agent, cwd, global);
        try {
          await fs.access(rulesPath);
          // Rules file exists, will be modified
          previewItems.push({
            agent,
            path: rulesPath,
            action: 'modify',
            size: '~1KB',
          });
        } catch {
          // Rules file doesn't exist, will be created
          previewItems.push({
            agent,
            path: rulesPath,
            action: 'create',
            size: '~1KB',
          });
        }
      }

      // Kiro creates multiple hook files
      if (agent === 'kiro') {
        const hooksDir = path.dirname(configPath);
        previewItems.push({
          agent,
          path: path.join(hooksDir, '*.kiro.hook'),
          action: 'create',
          size: '~500B each',
        });
      }
    }

    // Display preview
    console.log('');
    console.log('Files to be created/modified:');
    console.log('');

    for (const item of previewItems) {
      const icon = item.action === 'create' ? '➕' : '✏️';
      console.log(`${icon} ${item.path}`);
      console.log(`   ${item.action} (${item.size})`);
      console.log('');
    }

    // Summary
    const createCount = previewItems.filter((i) => i.action === 'create').length;
    const modifyCount = previewItems.filter((i) => i.action === 'modify').length;

    p.note(`${createCount} files to create, ${modifyCount} files to modify`);

    p.outro('Preview complete. Run "memorix hooks install" to apply.');
  },
});

function estimateFileSize(agent: string, configPath: string): string {
  const sizes: Record<string, string> = {
    claude: '~2KB',
    windsurf: '~1KB',
    cursor: '~3KB',
    copilot: '~2KB',
    kiro: '~500B',
    codex: '~1KB',
    antigravity: '~2KB',
    opencode: '~3KB',
    trae: '~1KB',
  };
  return sizes[agent] || '~2KB';
}

function getRulesPath(agent: string, cwd: string, global: boolean): string {
  const home = require('node:os').homedir();

  if (global) {
    switch (agent) {
      case 'cursor':
        return path.join(home, '.cursor', 'rules', 'memorix.mdc');
      case 'codex':
        return path.join(home, '.codex', 'AGENTS.md');
      case 'opencode':
        return path.join(home, '.opencode', 'AGENTS.md');
      case 'antigravity':
        return path.join(home, '.gemini', 'GEMINI.md');
      case 'trae':
        return path.join(home, '.trae', 'rules', 'project_rules.md');
      default:
        return '';
    }
  } else {
    switch (agent) {
      case 'cursor':
        return path.join(cwd, '.cursor', 'rules', 'memorix.mdc');
      case 'codex':
        return path.join(cwd, '.codex', 'AGENTS.md');
      case 'opencode':
        return path.join(cwd, '.opencode', 'AGENTS.md');
      case 'antigravity':
        return path.join(cwd, '.gemini', 'GEMINI.md');
      case 'trae':
        return path.join(cwd, '.trae', 'rules', 'project_rules.md');
      default:
        return '';
    }
  }
}
