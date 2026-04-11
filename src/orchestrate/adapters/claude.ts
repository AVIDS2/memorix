/**
 * Claude Code CLI adapter.
 *
 * Invocation: claude -p "<prompt>" --output-format json
 */

import { execSync } from 'node:child_process';
import { spawnAgent } from './spawn-helper.js';
import type { AgentAdapter, AgentProcess, SpawnOptions } from './types.js';

export class ClaudeAdapter implements AgentAdapter {
  name = 'claude';

  async available(): Promise<boolean> {
    try {
      execSync('claude --version', { stdio: 'ignore', timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  spawn(prompt: string, opts: SpawnOptions): AgentProcess {
    // Use stdin to avoid shell escaping issues with long prompts
    // --permission-mode bypassPermissions: auto-approve all tools (including MCP) in orchestrated headless mode
    return spawnAgent('claude', ['-p', '-', '--output-format', 'json', '--permission-mode', 'bypassPermissions'], opts, prompt);
  }
}
