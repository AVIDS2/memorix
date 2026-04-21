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
import { execSync } from 'node:child_process';

import type { AgentName, AgentHookConfig } from '../types.js';

/**
 * Resolve the hook command for the current platform.
 * On Windows, bare 'memorix' may resolve to a .ps1 script that non-PowerShell
 * environments can't execute. Using 'memorix.cmd' explicitly targets the CMD
 * shim that npm creates, which works in all shell environments and properly
 * forwards stdin (unlike 'cmd /c memorix' which can break stdin piping).
 */
function resolveHookCommand(): string {
  if (process.platform === 'win32') {
    return 'memorix.cmd';
  }
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
 *
 * Windows note: Copilot CLI executes the `powershell` field via pwsh.exe
 * (PowerShell v6+). If pwsh is not installed, the hook silently fails with
 * "spawn pwsh.exe ENOENT". Strategy:
 *   - If pwsh is available: include both bash and powershell fields
 *   - If pwsh is NOT available: omit the powershell field entirely,
 *     forcing Copilot to use the bash field (which works via Git Bash
 *     on Windows — a standard dev environment prerequisite)
 *   - Install/status commands warn if pwsh is missing on Windows
 */
function generateCopilotConfig(): Record<string, unknown> {
  const cmd = `${resolveHookCommand()} hook`;

  // Detect pwsh availability at install time
  const hasPwsh = detectPwsh();

  const hookEntry: Record<string, unknown> = {
    type: 'command',
    bash: cmd,
    timeoutSec: 10,
  };
  // Only include powershell field if pwsh is available — otherwise Copilot
  // will try to spawn pwsh.exe and fail with ENOENT
  if (hasPwsh) {
    hookEntry.powershell = cmd;
  }

  return {
    version: 1,
    hooks: {
      sessionStart: [hookEntry],
      sessionEnd: [hookEntry],
      userPromptSubmitted: [hookEntry],
      // NOTE: preToolUse intentionally omitted — VS Code Copilot requires
      // hookSpecificOutput.permissionDecision in the response; memorix is
      // an observer, not a gatekeeper, so we only use postToolUse.
      postToolUse: [hookEntry],
      errorOccurred: [hookEntry],
    },
  };
}

/**
 * Detect whether pwsh (PowerShell v6+) is available on the system.
 * Used by Copilot hook config generation to decide whether to include
 * the `powershell` field.
 */
function detectPwsh(): boolean {
  try {
    execSync('pwsh --version', { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate Gemini CLI / Antigravity hook config.
 * Format: .gemini/settings.json — PascalCase events, timeout in milliseconds
 * See: https://geminicli.com/docs/hooks/
 */
function generateGeminiConfig(): Record<string, unknown> {
  const cmd = `${resolveHookCommand()} hook`;

  // Gemini CLI hooks: defined in settings.json under "hooks" object.
  // Each event key (SessionStart, AfterTool, etc.) maps to an array of hook definitions.
  // No "enabled" flag needed — hooks are active simply by being defined.
  // See: https://geminicli.com/docs/hooks/reference/
  function entry(name: string, desc: string) {
    return {
      matcher: '*',
      hooks: [{ name, type: 'command', command: cmd, description: desc }],
    };
  }

  return {
    hooks: {
      SessionStart: [entry('memorix-session-start', 'Load memorix context at session start')],
      AfterTool: [entry('memorix-after-tool', 'Record tool usage in memorix')],
      AfterAgent: [entry('memorix-after-agent', 'Record agent response in memorix')],
      PreCompress: [entry('memorix-pre-compress', 'Save context before compression')],
    },
  };
}

/**
 * Generate Gemini CLI hook config (standalone CLI tool).
 * Same format as Antigravity but the command includes --agent gemini-cli
 * so the hook normalizer can reliably identify the source agent.
 */
function generateGeminiCLIConfig(): Record<string, unknown> {
  const cmd = `${resolveHookCommand()} hook --agent gemini-cli`;

  function entry(name: string, desc: string) {
    return {
      matcher: '*',
      hooks: [{ name, type: 'command', command: cmd, description: desc }],
    };
  }

  return {
    hooks: {
      SessionStart: [entry('memorix-session-start', 'Load memorix context at session start')],
      AfterTool: [entry('memorix-after-tool', 'Record tool usage in memorix')],
      AfterAgent: [entry('memorix-after-agent', 'Record agent response in memorix')],
      PreCompress: [entry('memorix-pre-compress', 'Save context before compression')],
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
          prompt: 'Before responding, load context:\n1. Call memorix_session_start to get previous session summary and key memories\n2. Call memorix_search with a query related to the user\'s prompt for additional context\n3. If search results are found, use memorix_detail to fetch the most relevant ones\n4. Reference relevant memories naturally in your response',
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
 * Generate OpenCode plugin file content.
 * Format: .opencode/plugins/memorix.js — Bun-compatible JS module
 * See: https://opencode.ai/docs/plugins/
 *
 * Plugin contract (verified against official docs Apr 2026):
 *   - Named export: export const MemorixPlugin = async (ctx) => { return { ... } }
 *   - Return object keys are EVENT NAMES (e.g. "session.created", "file.edited")
 *   - Each key maps to an async handler: (input, output) => { ... }
 *   - Session/file/command events: handler receives ({ event }) for event-style hooks
 *     OR (input, output) for tool-style hooks — both are valid
 *   - Local plugins in .opencode/plugins/ and ~/.config/opencode/plugins/ are
 *     automatically loaded at startup (no opencode.json registration needed)
 *   - The `plugin` array in opencode.json is for npm packages only
 *
 * The plugin hooks into OpenCode events and spawns `memorix hook` via
 * child_process.spawnSync, piping JSON over stdin, matching the same
 * protocol used by all agents. spawnSync works in both Node.js and Bun
 * runtimes (OpenCode may fall back to Node.js on Windows).
 */
const OPENCODE_PLUGIN_VERSION = 5;

function generateOpenCodePlugin(): string {
  return `/**
 * Memorix - Cross-Agent Memory Bridge Plugin for OpenCode
 * @generated-version ${OPENCODE_PLUGIN_VERSION}
 *
 * Automatically captures session context and tool usage,
 * piping events to \`memorix hook\` for cross-agent memory persistence.
 *
 * Plugin spec: https://opencode.ai/docs/plugins/
 * Generated by: memorix installHooks('opencode', projectRoot)
 * Docs: https://github.com/AVIDS2/memorix
 */
import { spawnSync } from 'node:child_process';

export const MemorixPlugin = async ({ project, client, $, directory, worktree }) => {
  // Generate a stable session ID for this plugin lifetime
  const sessionId = \`opencode-\${Date.now().toString(36)}-\${Math.random().toString(36).slice(2, 8)}\`;

  /**
   * Send event JSON to \`memorix hook\` via child_process.spawnSync.
   *
   * Uses spawnSync instead of Bun.spawn because:
   *  - child_process works in both Node.js and Bun runtimes
   *  - OpenCode may fall back to Node.js on Windows (Bun segfaults)
   *  - spawnSync is simpler: no stream lifecycle, no writer.close() bugs
   *  - stdin pipe via input option is reliable cross-platform
   */
  function runHook(payload) {
    payload.session_id = sessionId;
    const data = JSON.stringify(payload);
    const eventName = payload.hook_event_name || 'unknown';
    try {
      const cmd = process.platform === 'win32' ? 'memorix.cmd' : 'memorix';
      const result = spawnSync(cmd, ['hook'], {
        input: data,
        timeout: 10_000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (result.status !== 0) {
        console.error('[memorix-plugin] hook failed:', eventName,
          'exit=', result.status,
          'stderr=', (result.stderr || '').slice(0, 200));
      }
    } catch (e) {
      console.error('[memorix-plugin] hook delivery failed:', eventName, e?.message ?? e);
    }
  }

  return {
    /** Session created — record session start */
    'session.created': async ({ session }) => {
      runHook({
        agent: 'opencode',
        hook_event_name: 'session.created',
        cwd: directory,
      });
    },

    /** Session idle — record session end */
    'session.idle': async ({ session }) => {
      runHook({
        agent: 'opencode',
        hook_event_name: 'session.idle',
        cwd: directory,
      });
    },

    /** File edited — record file change */
    'file.edited': async (input, output) => {
      const filePath = input?.path ?? input?.file ?? '';
      runHook({
        agent: 'opencode',
        hook_event_name: 'file.edited',
        file_path: filePath,
        cwd: directory,
      });
    },

    /** Command executed — record command */
    'command.executed': async (input, output) => {
      runHook({
        agent: 'opencode',
        hook_event_name: 'command.executed',
        command: input?.command ?? input?.name ?? '',
        cwd: directory,
      });
    },

    /** Session compacted — record post-compact event */
    'session.compacted': async ({ session }) => {
      runHook({
        agent: 'opencode',
        hook_event_name: 'session.compacted',
        cwd: directory,
      });
    },

    /** Record tool usage after execution */
    'tool.execute.after': async (input, output) => {
      runHook({
        agent: 'opencode',
        hook_event_name: 'tool.execute.after',
        tool_name: input?.tool ?? '',
        tool_input: input?.args,
        cwd: directory,
      });
    },

    /** Structured continuation prompt for compaction (prompt-guided, not tool-automated) */
    'experimental.session.compacting': async (input, output) => {
      output.context.push(
        '## Continuation Context (Memorix)\\n' +
        'Include the following in the compaction summary so the next continuation can resume effectively:\\n' +
        '- **Current task**: what was being worked on and its status\\n' +
        '- **Key decisions**: architectural or design choices made this session\\n' +
        '- **Active files**: files currently being modified or reviewed\\n' +
        '- **Blockers**: any unresolved issues or errors\\n' +
        '- **Next steps**: what should happen next\\n' +
        '- **Active entities**: module names, config keys, or concepts in play\\n' +
        '- **Memorix context**: if memorix tools were used, note relevant entity names and memory topics for later retrieval'
      );
    },
  };
};
`;
}

/**
 * Get the config file path for an agent (project-level).
 */
export function getProjectConfigPath(agent: AgentName, projectRoot: string): string {
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
    case 'trae':
      // Trae has no hooks system — only rules (.trae/rules/project_rules.md)
      return path.join(projectRoot, '.trae', 'rules', 'project_rules.md');
    case 'opencode':
      // OpenCode uses plugin files for hooks
      return path.join(projectRoot, '.opencode', 'plugins', 'memorix.js');
    case 'antigravity':
      return path.join(projectRoot, '.gemini', 'settings.json');
    case 'gemini-cli':
      return path.join(projectRoot, '.gemini', 'settings.json');
    default:
      return path.join(projectRoot, '.memorix', 'hooks.json');
  }
}

/**
 * Get the global config file path for an agent.
 *
 * Returns empty string for agents that do not support global hooks.
 * Currently, Copilot only supports project-level hooks (.github/hooks/*.json)
 * per the official docs: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-hooks
 * Feature request for global hooks: https://github.com/github/copilot-cli/issues/1157
 */
export function getGlobalConfigPath(agent: AgentName): string {
  const home = os.homedir();
  switch (agent) {
    case 'claude':
      return path.join(home, '.claude', 'settings.json');
    case 'copilot':
      // GitHub Copilot does NOT support global hooks — only project-level
      // .github/hooks/*.json. See official docs and feature request #1157.
      return '';
    case 'windsurf':
      return path.join(home, '.codeium', 'windsurf', 'hooks.json');
    case 'cursor':
      return path.join(home, '.cursor', 'hooks.json');
    case 'antigravity':
      return path.join(home, '.gemini', 'settings.json');
    case 'gemini-cli':
      return path.join(home, '.gemini', 'settings.json');
    case 'opencode':
      return path.join(home, '.config', 'opencode', 'plugins', 'memorix.js');
    case 'trae':
      return path.join(home, '.trae', 'rules', 'project_rules.md');
    default:
      return path.join(home, '.memorix', 'hooks.json');
  }
}

/**
 * Detect whether VS Code Copilot extension is installed.
 * Checks for GitHub Copilot extension in VS Code extensions directories.
 * This is more accurate than checking ~/.vscode which exists for any VS Code user.
 */
async function detectCopilotExtension(home: string): Promise<boolean> {
  // Check common VS Code extensions directories
  const extDirs = [
    path.join(home, '.vscode', 'extensions'),
    path.join(home, '.vscode-insiders', 'extensions'),
  ];

  for (const extDir of extDirs) {
    try {
      const entries = await fs.readdir(extDir);
      // Copilot extension folder name starts with "github.copilot-"
      if (entries.some(e => e.startsWith('github.copilot-'))) {
        return true;
      }
    } catch { /* directory doesn't exist or not readable */ }
  }
  return false;
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

  // Check for VS Code Copilot — look for the Copilot extension in VS Code extensions dir,
  // not just ~/.vscode (which exists for any VS Code user, not just Copilot users).
  const copilotDetected = await detectCopilotExtension(home);
  if (copilotDetected) {
    agents.push('copilot');
  }

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

  // Check for Antigravity (Google's AI IDE)
  // Antigravity creates ~/.gemini/antigravity/ for its own configs (mcp_config.json, etc.)
  const antigravityDir = path.join(home, '.gemini', 'antigravity');
  try {
    await fs.access(antigravityDir);
    agents.push('antigravity');
  } catch { /* not installed */ }

  // Check for Gemini CLI (standalone CLI tool)
  // Detected by the presence of the `gemini` binary on PATH
  try {
    const { execSync } = await import('node:child_process');
    const whereCmd = process.platform === 'win32' ? 'where gemini' : 'which gemini';
    execSync(whereCmd, { stdio: 'ignore' });
    agents.push('gemini-cli');
  } catch { /* not installed */ }

  // Check for OpenCode
  const opencodeDir = path.join(home, '.config', 'opencode');
  try {
    await fs.access(opencodeDir);
    agents.push('opencode');
  } catch { /* not installed */ }

  // Check for Trae
  const traeDir = path.join(home, '.trae');
  try {
    await fs.access(traeDir);
    agents.push('trae');
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
  // Guard: reject global install for agents that don't support it
  if (global && getGlobalConfigPath(agent) === '') {
    return {
      agent,
      configPath: getProjectConfigPath(agent, projectRoot),
      events: [],
      generated: { note: `${agent} does not support global hooks — only project-level. Use without --global flag.` },
    };
  }

  const configPath = global
    ? getGlobalConfigPath(agent)
    : getProjectConfigPath(agent, projectRoot);

  // Clean up previous memorix-written files for this agent before reinstalling.
  // This ensures stale config from older versions is removed, while preserving
  // user's own customizations in shared config files (e.g. AGENTS.md, GEMINI.md).
  try {
    const { getProjectFiles, removeFile } = await import('../../audit/index.js');
    const prevFiles = await getProjectFiles(projectRoot);
    const agentPrev = prevFiles.filter(e => e.agent === agent);
    for (const entry of agentPrev) {
      try {
        const { access, unlink } = await import('node:fs/promises');
        await access(entry.path);
        // For shared context files (AGENTS.md, GEMINI.md), don't delete —
        // the install logic below will handle in-place update.
        const basename = path.basename(entry.path);
        if (basename === 'AGENTS.md' || basename === 'GEMINI.md' || basename === 'CONTEXT.md') {
          continue;
        }
        await unlink(entry.path);
        await removeFile(projectRoot, entry.path);
      } catch { /* file already gone */ }
    }
  } catch { /* audit cleanup is best-effort */ }

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
    case 'gemini-cli':
      generated = generateGeminiCLIConfig();
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
    case 'trae':
      // Trae has no hooks system — only install rules
      await installAgentRules(agent, projectRoot);
      return {
        agent,
        configPath: getProjectConfigPath(agent, projectRoot),
        events: [],
        generated: { note: 'Trae has no hooks system, only rules (.trae/rules/project_rules.md) installed' },
      };
    case 'opencode': {
      // OpenCode uses JS plugin files for hooks
      const pluginContent = generateOpenCodePlugin();
      const pluginPath = global
        ? getGlobalConfigPath(agent)
        : getProjectConfigPath(agent, projectRoot);
      await fs.mkdir(path.dirname(pluginPath), { recursive: true });
      await fs.writeFile(pluginPath, pluginContent, 'utf-8');
      
      // Record audit entry (non-critical, don't break install)
      try {
        const { recordFile } = await import('../../audit/index.js');
        await recordFile(projectRoot, 'hook', pluginPath, agent);
      } catch { /* audit is optional */ }
      
      await installAgentRules(agent, projectRoot);
      return {
        agent,
        configPath: pluginPath,
        events: ['session_start', 'session_end', 'post_tool', 'post_edit', 'post_compact', 'post_command'],
        generated: { note: 'OpenCode plugin installed at ' + pluginPath },
      };
    }
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
      const hookPath = path.join(hooksDir, hf.filename);
      await fs.writeFile(hookPath, hf.content, 'utf-8');
      
      // Record audit entry (non-critical, don't break install)
      try {
        const { recordFile } = await import('../../audit/index.js');
        await recordFile(projectRoot, 'hook', hookPath, agent);
      } catch { /* audit is optional */ }
    }
  } else {
    // JSON-based configs: merge with existing if present
    let existing: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      existing = JSON.parse(content);
    } catch { /* file doesn't exist yet */ }

    // Deep-merge generated keys so we don't overwrite user's existing config
    const gen = generated as Record<string, unknown>;
    const merged = { ...existing };

    // CRITICAL: version must be a number (Cursor requires this)
    // Always use generated version to fix corrupted configs
    if (typeof gen.version === 'number') {
      merged.version = gen.version;
    } else if (typeof merged.version !== 'number') {
      // Fallback: ensure version is always a number
      merged.version = 1;
    }

    // Merge 'hooks' key (all agents)
    if (gen.hooks && typeof gen.hooks === 'object') {
      const existingHooks = (existing.hooks && typeof existing.hooks === 'object')
        ? existing.hooks as Record<string, unknown>
        : {};
      merged.hooks = { ...existingHooks, ...(gen.hooks as Record<string, unknown>) };
    }

    // Merge 'tools' key (preserve any user-defined tools config)
    if (gen.tools && typeof gen.tools === 'object') {
      const existingTools = (existing.tools && typeof existing.tools === 'object')
        ? existing.tools as Record<string, unknown>
        : {};
      merged.tools = { ...existingTools, ...(gen.tools as Record<string, unknown>) };
    }

    // Clean up stale keys from older memorix versions
    if (agent === 'antigravity' || agent === 'gemini-cli') {
      const h = merged.hooks as Record<string, unknown> | undefined;
      if (h && typeof h.enabled === 'boolean') delete h.enabled;
      const t = merged.tools as Record<string, unknown> | undefined;
      if (t) {
        delete t.enableHooks;
        if (Object.keys(t).length === 0) delete merged.tools;
      }
    }
    if (agent === 'copilot') {
      // Remove preToolUse — VS Code Copilot requires hookSpecificOutput
      // in response which memorix doesn't provide (observer, not gatekeeper)
      const h = merged.hooks as Record<string, unknown> | undefined;
      if (h) delete h.preToolUse;
    }

    await fs.writeFile(configPath, JSON.stringify(merged, null, 2), 'utf-8');
    
    // Record audit entry (non-critical, don't break install)
    try {
      const { recordFile } = await import('../../audit/index.js');
      await recordFile(projectRoot, 'hook', configPath, agent);
    } catch { /* audit is optional */ }
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
    case 'gemini-cli':
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
    case 'opencode':
      // OpenCode reads AGENTS.md (same as Codex), also supports CLAUDE.md as fallback
      rulesPath = path.join(projectRoot, 'AGENTS.md');
      break;
    case 'antigravity':
      // Antigravity reads context from GEMINI.md by default
      rulesPath = path.join(projectRoot, 'GEMINI.md');
      break;
    case 'gemini-cli':
      // Gemini CLI reads context from GEMINI.md by default (like Codex reads AGENTS.md)
      // See: context.fileName defaults to ["GEMINI.md", "CONTEXT.md"]
      rulesPath = path.join(projectRoot, 'GEMINI.md');
      break;
    case 'trae':
      rulesPath = path.join(projectRoot, '.trae', 'rules', 'project_rules.md');
      break;
    default:
      rulesPath = path.join(projectRoot, '.agent', 'rules', 'memorix.md');
      break;
  }

  try {
    await fs.mkdir(path.dirname(rulesPath), { recursive: true });

    if (agent === 'codex' || agent === 'opencode' || agent === 'antigravity' || agent === 'gemini-cli') {
      // For shared context files (AGENTS.md / GEMINI.md), append rather than overwrite
      try {
        const existing = await fs.readFile(rulesPath, 'utf-8');
        if (existing.includes('Memorix')) {
          // Already contains memorix rules — but still record audit entry
          // in case audit.json was lost/corrupted and we're re-installing
          try {
            const { recordFile } = await import('../../audit/index.js');
            await recordFile(projectRoot, 'rule', rulesPath, agent);
          } catch { /* audit is optional */ }
          return;
        }
        // Append to existing file
        await fs.writeFile(rulesPath, existing + '\n\n' + rulesContent, 'utf-8');
        
        // Record audit entry (non-critical)
        try {
          const { recordFile } = await import('../../audit/index.js');
          await recordFile(projectRoot, 'rule', rulesPath, agent);
        } catch { /* audit is optional */ }
      } catch {
        // File doesn't exist, create it
        await fs.writeFile(rulesPath, rulesContent, 'utf-8');
        
        // Record audit entry (non-critical) — needed for uninstallHooks cleanup
        try {
          const { recordFile } = await import('../../audit/index.js');
          await recordFile(projectRoot, 'rule', rulesPath, agent);
        } catch { /* audit is optional */ }
      }
    } else {
      // Only write if not already present
      try {
        await fs.access(rulesPath);
        // File exists — don't overwrite user customizations
      } catch {
        await fs.writeFile(rulesPath, rulesContent, 'utf-8');
        
        // Record audit entry for new file (non-critical)
        try {
          const { recordFile } = await import('../../audit/index.js');
          await recordFile(projectRoot, 'rule', rulesPath, agent);
        } catch { /* audit is optional */ }
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

## RULE 1: Session Start — Bind Project, Then Load Context

At the **beginning of every conversation**, BEFORE responding to the user:

1. Call \`memorix_session_start\` with parameters:
   - \`agent\`: your agent identifier (e.g. "windsurf", "codex", "antigravity")
   - \`projectRoot\`: the **absolute path** of the current workspace or repo root
   This binds the session to the correct project. Without \`projectRoot\`, memories may go to the wrong bucket.
2. Then call \`memorix_search\` with a query related to the user's first message for additional context
3. If search results are found, use \`memorix_detail\` to fetch the most relevant ones
4. Reference relevant memories naturally — the user should feel you "remember" them

**Important:** \`projectRoot\` is a detection anchor only; Git remains the source of truth for project identity.
In HTTP control-plane mode (\`memorix serve-http\` / \`memorix background start\`), explicit \`projectRoot\` binding is required for correct multi-project isolation.
\`memorix_session_start\` is lightweight by default: it starts memory/session context only. Do not set \`joinTeam\` unless the user explicitly needs task, message, file-lock, or autonomous-agent collaboration features.

## RULE 2: Store Important Context

**Proactively** call \`memorix_store\` when any of the following happen:

### What MUST be recorded:
- Architecture/design decisions → type: \`decision\`
- Bug identified and fixed → type: \`problem-solution\`
- Unexpected behavior or gotcha → type: \`gotcha\`
- Config changed (env vars, ports, deps) → type: \`what-changed\`
- Feature completed or milestone → type: \`what-changed\`
- Trade-off discussed with conclusion → type: \`trade-off\`

### What should NOT be recorded:
- Simple file reads, greetings, trivial commands (ls, pwd, git status)

### Use topicKey for evolving topics:
For decisions, architecture docs, or any topic that evolves over time, ALWAYS use \`topicKey\` parameter.
This ensures the memory is UPDATED instead of creating duplicates.
Use \`memorix_suggest_topic_key\` to generate a stable key.

Example: \`topicKey: "architecture/auth-model"\` — subsequent stores with the same key update the existing memory.

### Track progress with the progress parameter:
When working on features or tasks, include the \`progress\` parameter:
\`\`\`json
{
  "progress": {
    "feature": "user authentication",
    "status": "in-progress",
    "completion": 60
  }
}
\`\`\`
Status values: \`in-progress\`, \`completed\`, \`blocked\`

## RULE 3: Resolve Completed Memories

When a task is completed, a bug is fixed, or information becomes outdated:

1. Call \`memorix_resolve\` with the observation IDs to mark them as resolved
2. Resolved memories are hidden from default search, preventing context pollution

This is critical — without resolving, old bug reports and completed tasks will keep appearing in future searches.

## RULE 4: Session End — Store Decision Chain Summary

When the conversation is ending, create a **decision chain summary** (not just a checklist):

1. Call \`memorix_store\` with type \`session-request\` and \`topicKey: "session/latest-summary"\`:

   **Required structure:**
   \`\`\`
   ## Goal
   [What we were working on — specific, not vague]

   ## Key Decisions & Reasoning
   - Chose X because Y. Rejected Z because [reason].
   - [Every architectural/design decision with WHY]

   ## What Changed
   - [File path] — [what changed and why]

   ## Current State
   - [What works now, what's pending]
   - [Any blockers or risks]

   ## Next Steps
   - [Concrete next actions, in priority order]
   \`\`\`

   **Critical: Include the "Key Decisions & Reasoning" section.** Without it, the next AI session will lack the context to understand WHY things were done a certain way and may suggest conflicting approaches.

2. Call \`memorix_resolve\` on any memories for tasks completed in this session

## RULE 5: Compact Awareness

Memorix automatically compacts memories on store:
- **With LLM API configured:** Smart dedup — extracts facts, compares with existing, merges or skips duplicates
- **Without LLM (free mode):** Heuristic dedup — uses similarity scores to detect and merge duplicate memories
- **You don't need to manually deduplicate.** Just store naturally and compact handles the rest.
- If you notice excessive duplicate memories, call \`memorix_deduplicate\` for batch cleanup.

## Guidelines

- **Use concise titles** (~5-10 words) and structured facts
- **Include file paths** in filesModified when relevant
- **Include related concepts** for better searchability
- **Always use topicKey** for recurring topics to prevent duplicates
- **Always resolve** completed tasks and fixed bugs
- **Always include reasoning** — "chose X because Y" is 10x more valuable than "did X"
- Search defaults to \`status="active"\` — use \`status="all"\` to include resolved memories

## Beyond These Rules

This file contains the **minimum operating rules** for Memorix memory tools. It is NOT the complete truth about runtime behavior, support tiers, or team semantics.

For authoritative, up-to-date details on:
- **Support tiers** (core / extended / community) and what "installed" vs "runtime-ready" means
- **HTTP control-plane binding** and \`projectRoot\` isolation rules
- **Opt-in team semantics** (\`joinTeam\`, \`team_manage join\`, roles, task claim, handoff validation)
- **Install vs runtime-ready distinction** — hook config written ≠ agent will execute it
- **Agent-specific caveats** (Copilot project-level only, OpenCode plugin lifecycle, etc.)

→ **Read \`docs/AGENT_OPERATOR_PLAYBOOK.md\`** in the Memorix source or npm package.

If this file and the playbook conflict, the playbook is authoritative.
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
  // Guard: reject global uninstall for agents that don't support it
  if (global && getGlobalConfigPath(agent) === '') {
    return false;
  }

  const configPath = global
    ? getGlobalConfigPath(agent)
    : getProjectConfigPath(agent, projectRoot);

  let success = false;

  try {
    if (agent === 'kiro' || agent === 'opencode') {
      await fs.unlink(configPath);
      success = true;
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
      success = true;
    }
  } catch { /* config file may not exist */ }

  // Also clean up rules files written by memorix
  let auditCleaned = false;
  try {
    const { getProjectFiles, removeFile } = await import('../../audit/index.js');
    const prevFiles = await getProjectFiles(projectRoot);
    const agentFiles = prevFiles.filter(e => e.agent === agent);
    for (const entry of agentFiles) {
      try {
        const basename = path.basename(entry.path);
        // Shared context files: remove only the Memorix block, not the whole file
        if (basename === 'AGENTS.md' || basename === 'GEMINI.md' || basename === 'CONTEXT.md') {
          try {
            const content = await fs.readFile(entry.path, 'utf-8');
            const memorixStart = content.indexOf('# Memorix');
            if (memorixStart >= 0) {
              // Find the next top-level heading after Memorix block
              const afterMemorix = content.substring(memorixStart);
              const nextHeadingMatch = afterMemorix.match(/\n# [^#]/);
              let before = content.substring(0, memorixStart).trimEnd();
              let after = '';
              if (nextHeadingMatch && nextHeadingMatch.index != null) {
                after = afterMemorix.substring(nextHeadingMatch.index + 1).trimStart();
              }
              const cleaned = (before + '\n' + after).trim();
              if (cleaned.length === 0) {
                // File only had Memorix content — delete it
                await fs.unlink(entry.path);
              } else {
                await fs.writeFile(entry.path, cleaned + '\n', 'utf-8');
              }
            }
          } catch { /* file read failed, skip */ }
          await removeFile(projectRoot, entry.path);
          auditCleaned = true;
          continue;
        }
        // Non-shared files: safe to unlink entirely
        await fs.unlink(entry.path);
        await removeFile(projectRoot, entry.path);
        auditCleaned = true;
      } catch { /* file already gone */ }
    }
  } catch { /* audit cleanup is best-effort */ }

  // For rules-only agents, audit cleanup success counts as overall success
  if (auditCleaned) success = true;

  // Remove empty parent directories left behind (e.g. .cursor/rules/ if empty)
  if (success) {
    try {
      const { rm } = await import('node:fs/promises');
      const dir = path.dirname(configPath);
      // Try to remove empty dirs up to project root (max 3 levels)
      let current = dir;
      for (let i = 0; i < 3; i++) {
        try {
          const entries = await fs.readdir(current);
          if (entries.length === 0) {
            await rm(current, { recursive: true });
            current = path.dirname(current);
          } else {
            break; // non-empty dir, stop
          }
        } catch { break; }
      }
    } catch { /* cleanup is best-effort */ }
  }

  return success;
}

/**
 * Check hook installation status for all agents.
 *
 * For config-based agents (Claude, Cursor, etc.), file existence is a reliable
 * indicator because the agent reads the config file directly.
 *
 * For OpenCode (plugin-based), file existence alone is NOT sufficient to confirm
 * the plugin is actually loaded and firing events. The `verified` field distinguishes:
 *   - false: plugin file exists but runtime load is unverified
 *   - true:  not currently achievable programmatically (would require OpenCode API)
 *
 * The `outdated` field for OpenCode also detects the old v3 plugin (which used an
 * invalid catch-all `event` handler that never fires) vs the correct v4+ format
 * (individual event-name keys like `session.created`, `file.edited`).
 */
export async function getHookStatus(
  projectRoot: string,
): Promise<Array<{ agent: AgentName; installed: boolean; outdated: boolean; verified: boolean; runtimeReady: boolean; configPath: string }>> {
  const results: Array<{ agent: AgentName; installed: boolean; outdated: boolean; verified: boolean; runtimeReady: boolean; configPath: string }> = [];
  const agents: AgentName[] = ['claude', 'copilot', 'windsurf', 'cursor', 'kiro', 'codex', 'antigravity', 'gemini-cli', 'opencode', 'trae'];

  for (const agent of agents) {
    const projectPath = getProjectConfigPath(agent, projectRoot);
    const globalPath = getGlobalConfigPath(agent);

    let installed = false;
    let outdated = false;
    let usedPath = projectPath;

    // Config-based agents: file existence = verified (agent reads config directly)
    // Plugin-based agents (OpenCode): file existence ≠ verified (must be loaded by runtime)
    const verifiedByDefault = agent !== 'opencode';

    try {
      await fs.access(projectPath);
      installed = true;
    } catch {
      // Only check global path if the agent actually supports global hooks
      // (empty string = not supported, e.g. Copilot)
      if (globalPath) {
        try {
          await fs.access(globalPath);
          installed = true;
          usedPath = globalPath;
        } catch { /* not installed */ }
      }
    }

    if (installed && agent === 'opencode') {
      try {
        const content = await fs.readFile(usedPath, 'utf-8');
        const match = content.match(/@generated-version\s+(\d+)/);
        const installedVersion = match ? parseInt(match[1], 10) : 0;
        outdated = installedVersion < OPENCODE_PLUGIN_VERSION;
      } catch {
        outdated = false;
      }
    }

    // Runtime readiness: Copilot on Windows requires pwsh for the powershell field
    let runtimeReady = true;
    if (agent === 'copilot' && process.platform === 'win32' && installed) {
      runtimeReady = detectPwsh();
    }

    results.push({
      agent,
      installed,
      outdated,
      verified: installed && verifiedByDefault,
      runtimeReady,
      configPath: usedPath,
    });
  }

  return results;
}
