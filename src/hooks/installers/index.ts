/**
 * Hook Installers
 *
 * Auto-detect installed agents and generate hook configurations.
 * Each agent has a different config format but the hook command is the same:
 *   memorix hook
 *
 * The hook handler reads stdin JSON from the agent, normalizes it, and auto-stores.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createRequire } from 'node:module';
import type { AgentName, AgentHookConfig } from '../types.js';

/**
 * Resolve the hook command for the current platform.
 * On Windows, 'memorix' resolves to a .ps1 script that non-PowerShell
 * environments (like Windsurf hooks) can't execute.
 * Solution: use 'node /path/to/cli/index.js hook' instead.
 */
function resolveHookCommand(): string {
  if (process.platform === 'win32') {
    // Try to find the CLI script path
    try {
      // 1. Check if running from source (development)
      const devPath = path.resolve(import.meta.dirname ?? __dirname, '../../cli/index.js');
      try {
        const fsStat = require('node:fs');
        if (fsStat.existsSync(devPath)) {
          return `node ${devPath.replace(/\\/g, '/')}`;
        }
      } catch { /* ignore */ }

      // 2. Find globally installed memorix
      const require_ = createRequire(import.meta.url);
      const pkgPath = require_.resolve('memorix/package.json');
      const cliPath = path.join(path.dirname(pkgPath), 'dist', 'cli', 'index.js');
      return `node ${cliPath.replace(/\\/g, '/')}`;
    } catch {
      // 3. Fallback: assume memorix is in PATH via cmd (not .ps1)
      return 'memorix';
    }
  }
  // On Unix, 'memorix' works directly
  return 'memorix';
}

/**
 * Generate Claude Code hook config.
 * Format: .claude/settings.json
 * See: https://docs.anthropic.com/en/docs/claude-code/hooks
 */
function generateClaudeConfig(): Record<string, unknown> {
  const cmd = `${resolveHookCommand()} hook`;
  const hookEntry = {
    type: 'command',
    command: cmd,
    timeout: 10,
  };

  return {
    hooks: {
      SessionStart: [{ hooks: [hookEntry] }],
      PostToolUse: [{ hooks: [hookEntry] }],
      UserPromptSubmit: [{ hooks: [hookEntry] }],
      PreCompact: [{ hooks: [hookEntry] }],
      Stop: [{ hooks: [hookEntry] }],
    },
  };
}

/**
 * Generate GitHub Copilot hook config.
 * Format: .github/hooks/memorix.json — version:1 + bash/powershell fields
 * See: https://docs.github.com/en/copilot/reference/hooks-configuration
 */
function generateCopilotConfig(): Record<string, unknown> {
  const cmd = `${resolveHookCommand()} hook`;
  const hookEntry = {
    type: 'command',
    bash: cmd,
    powershell: cmd,
    timeoutSec: 10,
  };

  return {
    version: 1,
    hooks: {
      sessionStart: [hookEntry],
      sessionEnd: [hookEntry],
      userPromptSubmitted: [hookEntry],
      preToolUse: [hookEntry],
      postToolUse: [hookEntry],
      errorOccurred: [hookEntry],
    },
  };
}

/**
 * Generate Gemini CLI / Antigravity hook config.
 * Format: .gemini/settings.json — PascalCase events, timeout in milliseconds
 * See: https://geminicli.com/docs/hooks/
 */
function generateGeminiConfig(): Record<string, unknown> {
  const cmd = `${resolveHookCommand()} hook`;
  const hookEntry = {
    type: 'command',
    command: cmd,
    timeout: 10000,
  };

  return {
    hooks: {
      SessionStart: [{ hooks: [hookEntry] }],
      AfterTool: [{ hooks: [hookEntry] }],
      AfterAgent: [{ hooks: [hookEntry] }],
      PreCompress: [{ hooks: [hookEntry] }],
    },
  };
}

/**
 * Generate Windsurf Cascade hooks config.
 */
function generateWindsurfConfig(): Record<string, unknown> {
  const cmd = `${resolveHookCommand()} hook`;
  const hookEntry = {
    command: cmd,
    show_output: false,
  };

  return {
    hooks: {
      post_write_code: [hookEntry],
      post_run_command: [hookEntry],
      post_mcp_tool_use: [hookEntry],
      pre_user_prompt: [hookEntry],
      post_cascade_response: [hookEntry],
    },
  };
}

/**
 * Generate Cursor hooks config.
 */
function generateCursorConfig(): Record<string, unknown> {
  const cmd = `${resolveHookCommand()} hook`;
  // Cursor hooks format: version (number) + each event is an array of hook scripts
  // See: https://cursor.com/docs/agent/hooks
  const hookScript = { command: cmd };
  return {
    version: 1,
    hooks: {
      sessionStart: [hookScript],
      beforeSubmitPrompt: [hookScript],
      afterFileEdit: [hookScript],
      beforeShellExecution: [hookScript],
      afterMCPExecution: [hookScript],
      preCompact: [hookScript],
      stop: [hookScript],
    },
  };
}

/**
 * Generate Kiro hook files.
 * Format: .kiro/hooks/*.kiro.hook — JSON config
 * See: https://kiro.dev/docs/hooks/
 * Schema confirmed from: github.com/awsdataarchitect/kiro-best-practices
 */
function generateKiroHookFiles(): Array<{ filename: string; content: string }> {
  const cmd = `${resolveHookCommand()} hook`;
  return [
    {
      filename: 'memorix-agent-stop.kiro.hook',
      content: JSON.stringify({
        enabled: true,
        name: 'Memorix Session Memory',
        description: 'Record session context when agent completes a turn',
        version: '1',
        when: { type: 'agentStop' },
        then: {
          type: 'askAgent',
          prompt: 'Call memorix MCP tools to store important context from this conversation:\n1. Use memorix_store to record any decisions, bug fixes, gotchas, or configuration changes\n2. Include relevant file paths and concepts for searchability',
        },
      }, null, 2),
    },
    {
      filename: 'memorix-prompt-submit.kiro.hook',
      content: JSON.stringify({
        enabled: true,
        name: 'Memorix Context Loader',
        description: 'Load relevant memories when user submits a prompt',
        version: '1',
        when: { type: 'promptSubmit' },
        then: {
          type: 'askAgent',
          prompt: 'Before responding, search for relevant context:\n1. Call memorix_search with a query related to the user\'s prompt\n2. If results are found, use memorix_detail to fetch the most relevant ones\n3. Reference relevant memories naturally in your response',
        },
      }, null, 2),
    },
    {
      filename: 'memorix-file-save.kiro.hook',
      content: JSON.stringify({
        enabled: true,
        name: 'Memorix File Change Tracker',
        description: 'Track significant file changes for cross-session memory',
        version: '1',
        when: {
          type: 'fileEdited',
          patterns: ['**/*.ts', '**/*.js', '**/*.tsx', '**/*.jsx', '**/*.py', '**/*.rs', '**/*.go', '**/*.java', '**/*.md'],
        },
        then: {
          type: 'runCommand',
          command: cmd,
        },
      }, null, 2),
    },
  ];
}

/**
 * Get the config file path for an agent (project-level).
 */
function getProjectConfigPath(agent: AgentName, projectRoot: string): string {
  switch (agent) {
    case 'claude':
      // Claude Code reads hooks from .claude/settings.local.json (project-level, gitignored)
      return path.join(projectRoot, '.claude', 'settings.local.json');
    case 'copilot':
      return path.join(projectRoot, '.github', 'hooks', 'memorix.json');
    case 'windsurf':
      return path.join(projectRoot, '.windsurf', 'hooks.json');
    case 'cursor':
      return path.join(projectRoot, '.cursor', 'hooks.json');
    case 'kiro':
      return path.join(projectRoot, '.kiro', 'hooks', 'memorix-agent-stop.kiro.hook');
    case 'codex':
      // Codex has no hooks system — only rules (AGENTS.md)
      return path.join(projectRoot, 'AGENTS.md');
    case 'antigravity':
      return path.join(projectRoot, '.gemini', 'settings.json');
    default:
      return path.join(projectRoot, '.memorix', 'hooks.json');
  }
}

/**
 * Get the global config file path for an agent.
 */
function getGlobalConfigPath(agent: AgentName): string {
  const home = os.homedir();
  switch (agent) {
    case 'claude':
    case 'copilot':
      return path.join(home, '.claude', 'settings.json');
    case 'windsurf':
      return path.join(home, '.codeium', 'windsurf', 'hooks.json');
    case 'cursor':
      return path.join(home, '.cursor', 'hooks.json');
    case 'antigravity':
      return path.join(home, '.gemini', 'settings.json');
    default:
      return path.join(home, '.memorix', 'hooks.json');
  }
}

/**
 * Detect which agents are installed on the system.
 */
export async function detectInstalledAgents(): Promise<AgentName[]> {
  const agents: AgentName[] = [];
  const home = os.homedir();

  // Check for Claude Code
  const claudeDir = path.join(home, '.claude');
  try {
    await fs.access(claudeDir);
    agents.push('claude');
  } catch { /* not installed */ }

  // Check for Windsurf
  const windsurfDir = path.join(home, '.codeium', 'windsurf');
  try {
    await fs.access(windsurfDir);
    agents.push('windsurf');
  } catch { /* not installed */ }

  // Check for Cursor
  const cursorDir = path.join(home, '.cursor');
  try {
    await fs.access(cursorDir);
    agents.push('cursor');
  } catch { /* not installed */ }

  // Check for VS Code Copilot (independent of Claude Code — different hook paths)
  const vscodeDir = path.join(home, '.vscode');
  try {
    await fs.access(vscodeDir);
    agents.push('copilot');
  } catch { /* not installed */ }

  // Check for Kiro
  const kiroConfig = path.join(home, '.kiro');
  try {
    await fs.access(kiroConfig);
    agents.push('kiro');
  } catch { /* not installed */ }

  // Check for Codex
  const codexDir = path.join(home, '.codex');
  try {
    await fs.access(codexDir);
    agents.push('codex');
  } catch { /* not installed */ }

  // Check for Antigravity / Gemini CLI (both share ~/.gemini/)
  const geminiDir = path.join(home, '.gemini');
  try {
    await fs.access(geminiDir);
    agents.push('antigravity');
  } catch { /* not installed */ }

  return agents;
}

/**
 * Install hooks for a specific agent.
 */
export async function installHooks(
  agent: AgentName,
  projectRoot: string,
  global = false,
): Promise<AgentHookConfig> {
  const configPath = global
    ? getGlobalConfigPath(agent)
    : getProjectConfigPath(agent, projectRoot);

  let generated: Record<string, unknown> | string;

  switch (agent) {
    case 'claude':
      generated = generateClaudeConfig();
      break;
    case 'copilot':
      generated = generateCopilotConfig();
      break;
    case 'windsurf':
      generated = generateWindsurfConfig();
      break;
    case 'cursor':
      generated = generateCursorConfig();
      break;
    case 'antigravity':
      generated = generateGeminiConfig();
      break;
    case 'kiro':
      generated = 'kiro-multi'; // handled separately below
      break;
    case 'codex':
      // Codex has no hooks — only install rules
      await installAgentRules(agent, projectRoot);
      return {
        agent,
        configPath: getProjectConfigPath(agent, projectRoot),
        events: [],
        generated: { note: 'Codex has no hooks system, only rules (AGENTS.md) installed' },
      };
    default:
      generated = generateClaudeConfig(); // fallback
  }

  // Ensure directory exists
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  if (agent === 'kiro') {
    // Kiro uses multiple .kiro.hook files
    const hookFiles = generateKiroHookFiles();
    const hooksDir = path.join(path.dirname(configPath));
    await fs.mkdir(hooksDir, { recursive: true });
    for (const hf of hookFiles) {
      await fs.writeFile(path.join(hooksDir, hf.filename), hf.content, 'utf-8');
    }
  } else {
    // JSON-based configs: merge with existing if present
    let existing: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      existing = JSON.parse(content);
    } catch { /* file doesn't exist yet */ }

    // Deep-merge the 'hooks' key so we don't overwrite user's existing hooks
    const gen = generated as Record<string, unknown>;
    const merged = { ...existing };
    if (gen.hooks && typeof gen.hooks === 'object') {
      const existingHooks = (existing.hooks && typeof existing.hooks === 'object')
        ? existing.hooks as Record<string, unknown>
        : {};
      merged.hooks = { ...existingHooks, ...(gen.hooks as Record<string, unknown>) };
    }

    await fs.writeFile(configPath, JSON.stringify(merged, null, 2), 'utf-8');
  }

  const events: Array<import('../types.js').HookEvent> = [];
  switch (agent) {
    case 'claude':
      events.push('session_start', 'post_tool', 'user_prompt', 'pre_compact', 'session_end');
      break;
    case 'copilot':
      events.push('session_start', 'session_end', 'user_prompt', 'post_tool');
      break;
    case 'windsurf':
      events.push('post_edit', 'post_command', 'post_tool', 'user_prompt', 'post_response');
      break;
    case 'cursor':
      events.push('session_start', 'user_prompt', 'post_edit', 'post_tool', 'pre_compact', 'session_end');
      break;
    case 'antigravity':
      events.push('session_start', 'post_tool', 'post_response', 'pre_compact');
      break;
    case 'kiro':
      events.push('session_end', 'user_prompt', 'post_edit');
      break;
  }

  // Install agent rules alongside hooks
  await installAgentRules(agent, projectRoot);

  return {
    agent,
    configPath,
    events,
    generated: typeof generated === 'string' ? { content: generated } : generated,
  };
}

/**
 * Install memorix agent rules for a specific agent.
 * Rules instruct the agent to proactively use memorix for context continuity.
 */
async function installAgentRules(agent: AgentName, projectRoot: string): Promise<void> {
  const rulesContent = getAgentRulesContent(agent);
  let rulesPath: string;

  switch (agent) {
    case 'windsurf':
      rulesPath = path.join(projectRoot, '.windsurf', 'rules', 'memorix.md');
      break;
    case 'cursor':
      rulesPath = path.join(projectRoot, '.cursor', 'rules', 'memorix.mdc');
      break;
    case 'claude':
    case 'copilot':
      rulesPath = path.join(projectRoot, '.github', 'copilot-instructions.md');
      break;
    case 'codex':
      rulesPath = path.join(projectRoot, 'AGENTS.md');
      break;
    case 'kiro':
      rulesPath = path.join(projectRoot, '.kiro', 'steering', 'memorix.md');
      break;
    default:
      // Antigravity and others
      rulesPath = path.join(projectRoot, '.agent', 'rules', 'memorix.md');
      break;
  }

  try {
    await fs.mkdir(path.dirname(rulesPath), { recursive: true });

    if (agent === 'codex') {
      // For Codex AGENTS.md, append rather than overwrite
      try {
        const existing = await fs.readFile(rulesPath, 'utf-8');
        if (existing.includes('Memorix')) {
          return; // Already contains memorix rules
        }
        // Append to existing AGENTS.md
        await fs.writeFile(rulesPath, existing + '\n\n' + rulesContent, 'utf-8');
      } catch {
        // File doesn't exist, create it
        await fs.writeFile(rulesPath, rulesContent, 'utf-8');
      }
    } else {
      // Only write if not already present
      try {
        await fs.access(rulesPath);
        // File exists — don't overwrite user customizations
      } catch {
        await fs.writeFile(rulesPath, rulesContent, 'utf-8');
      }
    }
  } catch { /* silent */ }
}

/**
 * Get the memorix agent rules content.
 * Windsurf requires YAML frontmatter with trigger mode.
 * Cursor .mdc files use a similar frontmatter format.
 */
function getAgentRulesContent(agent?: AgentName): string {
  let frontmatter = '';
  if (agent === 'windsurf') {
    frontmatter = `---
trigger: always_on
---

`;
  } else if (agent === 'cursor') {
    frontmatter = `---
description: Memorix automatic memory recording rules
alwaysApply: true
---

`;
  }
  return `${frontmatter}# Memorix — Automatic Memory Rules

You have access to Memorix memory tools. Follow these rules to maintain persistent context across sessions.

## Session Start — Load Context

At the **beginning of every conversation**, before responding to the user:

1. Call \`memorix_search\` with a query related to the user's first message or the current project
2. If results are found, use \`memorix_detail\` to fetch the most relevant ones
3. Reference relevant memories naturally in your response — the user should feel you "remember" them

This ensures you already know the project context without the user re-explaining.

## During Session — Capture Important Context

**Proactively** call \`memorix_store\` whenever any of the following happen:

### Architecture & Decisions
- Technology choice, framework selection, or design pattern adopted
- Trade-off discussion with a clear conclusion
- API design, database schema, or project structure decisions

### Bug Fixes & Problem Solving
- A bug is identified and resolved — store root cause + fix
- Workaround applied for a known issue
- Performance issue diagnosed and optimized

### Gotchas & Pitfalls
- Something unexpected or tricky is discovered
- A common mistake is identified and corrected
- Platform-specific behavior that caused issues

### Configuration & Environment
- Environment variables, port numbers, paths changed
- Docker, nginx, Caddy, or reverse proxy config modified
- Package dependencies added, removed, or version-pinned

### Deployment & Operations
- Server deployment steps (Docker, VPS, cloud)
- DNS, SSL/TLS certificate, domain configuration
- CI/CD pipeline setup or changes
- Database migration or data transfer procedures
- Server topology (ports, services, reverse proxy chain)
- SSH keys, access credentials setup (store pattern, NOT secrets)

### Project Milestones
- Feature completed or shipped
- Version released or published to npm/PyPI/etc.
- Repository made public, README updated, PR submitted

Use appropriate types: \`decision\`, \`problem-solution\`, \`gotcha\`, \`what-changed\`, \`discovery\`, \`how-it-works\`.

## Session End — Store Summary

When the conversation is ending or the user says goodbye:

1. Call \`memorix_store\` with type \`session-request\` to record:
   - What was accomplished in this session
   - Current project state and any blockers
   - Pending tasks or next steps
   - Key files modified

This creates a "handoff note" for the next session (or for another AI agent).

## Guidelines

- **Don't store trivial information** (greetings, acknowledgments, simple file reads, ls/dir output)
- **Do store anything you'd want to know if you lost all context**
- **Do store anything a different AI agent would need to continue this work**
- **Use concise titles** (~5-10 words) and structured facts
- **Include file paths** in filesModified when relevant
- **Include related concepts** for better searchability
- **Prefer storing too much over too little** — the retention system will auto-decay stale memories
`;
}

/**
 * Uninstall hooks for a specific agent.
 */
export async function uninstallHooks(
  agent: AgentName,
  projectRoot: string,
  global = false,
): Promise<boolean> {
  const configPath = global
    ? getGlobalConfigPath(agent)
    : getProjectConfigPath(agent, projectRoot);

  try {
    if (agent === 'kiro') {
      await fs.unlink(configPath);
    } else {
      // For JSON configs, remove the hooks key
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      delete config.hooks;

      if (Object.keys(config).length === 0) {
        await fs.unlink(configPath);
      } else {
        await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Check hook installation status for all agents.
 */
export async function getHookStatus(
  projectRoot: string,
): Promise<Array<{ agent: AgentName; installed: boolean; configPath: string }>> {
  const results: Array<{ agent: AgentName; installed: boolean; configPath: string }> = [];
  const agents: AgentName[] = ['claude', 'copilot', 'windsurf', 'cursor', 'kiro', 'codex', 'antigravity'];

  for (const agent of agents) {
    const projectPath = getProjectConfigPath(agent, projectRoot);
    const globalPath = getGlobalConfigPath(agent);

    let installed = false;
    let usedPath = projectPath;

    try {
      await fs.access(projectPath);
      installed = true;
    } catch {
      try {
        await fs.access(globalPath);
        installed = true;
        usedPath = globalPath;
      } catch { /* not installed */ }
    }

    results.push({ agent, installed, configPath: usedPath });
  }

  return results;
}
