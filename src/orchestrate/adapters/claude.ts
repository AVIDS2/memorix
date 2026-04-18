/**
 * Claude Code CLI adapter.
 *
 * Invocation: claude -p - --output-format stream-json --verbose --bare
 *   --permission-mode bypassPermissions --mcp-config <path>
 *
 * --bare is essential for headless orchestration: it skips hooks, LSP,
 * plugin sync, attribution, auto-memory, background prefetches,
 * keychain reads, and CLAUDE.md auto-discovery. Without --bare,
 * Claude Code attempts interactive operations that cause hangs
 * in non-TTY orchestrated environments.
 *
 * --mcp-config is passed alongside --bare so the agent can still
 * access Memorix MCP tools (session_start, store, handoff, etc.).
 *
 * Uses stream-json output format for:
 *   - Real-time tool_use / text / thinking events
 *   - Token usage tracking per model
 *   - Session ID capture for future session reuse
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnAgentWithStream, isCommandAvailable } from './spawn-helper.js';
import { parseClaudeStreamLine, createStreamState } from './claude-stream.js';
import type { AgentAdapter, AgentProcess, SpawnOptions } from './types.js';

/**
 * Resolve the MCP config path for a project directory.
 * Checks for existing .claude/settings.local.json (from hooks install),
 * then .claude/settings.json, then falls back to generating a temporary
 * config that includes the Memorix MCP server.
 */
function resolveMcpConfigPath(projectDir: string): string | null {
  // Prefer existing project-level config (from `memorix hooks install --agent claude`)
  const localPath = path.join(projectDir, '.claude', 'settings.local.json');
  try { if (fs.existsSync(localPath)) return localPath; } catch { /* ignore */ }

  const settingsPath = path.join(projectDir, '.claude', 'settings.json');
  try { if (fs.existsSync(settingsPath)) return settingsPath; } catch { /* ignore */ }

  // No existing config — generate a temporary one with Memorix MCP server
  const mcpConfig = {
    mcpServers: {
      memorix: {
        command: process.execPath,
        args: [path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'memorix', 'dist', 'index.js'), 'serve', '--transport', 'stdio'],
      },
    },
  };

  // Try to use the memorix CLI directly (more reliable than path guessing)
  const memorixCmd = process.platform === 'win32' ? 'memorix.cmd' : 'memorix';
  mcpConfig.mcpServers.memorix = {
    command: memorixCmd,
    args: ['serve', '--transport', 'stdio'],
  };

  try {
    const claudeDir = path.join(projectDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const tempPath = path.join(claudeDir, 'settings.local.json');
    fs.writeFileSync(tempPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
    return tempPath;
  } catch {
    return null;
  }
}

export class ClaudeAdapter implements AgentAdapter {
  name = 'claude';

  async available(): Promise<boolean> {
    return isCommandAvailable('claude');
  }

  spawn(prompt: string, opts: SpawnOptions): AgentProcess {
    const state = createStreamState();

    const args = [
      '-p', '-',
      '--output-format', 'stream-json',
      '--verbose',
      '--bare',
      '--permission-mode', 'bypassPermissions',
    ];

    // Pass MCP config so the agent can use Memorix tools even in --bare mode
    const mcpConfigPath = opts.cwd ? resolveMcpConfigPath(opts.cwd) : null;
    if (mcpConfigPath) {
      args.push('--mcp-config', mcpConfigPath);
    }

    if (opts.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId);
    }

    return spawnAgentWithStream(
      'claude',
      args,
      opts,
      prompt,
      (line) => parseClaudeStreamLine(line, state),
      (result) => ({
        ...result,
        tokenUsage: Object.keys(state.usage).length > 0 ? { ...state.usage } : undefined,
        sessionId: state.sessionId,
      }),
    );
  }
}
