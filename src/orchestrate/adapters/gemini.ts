/**
 * Gemini CLI adapter.
 *
 * Invocation: echo "<prompt>" | gemini -p ""
 * Gemini's -p flag enables headless mode and is "appended to input on stdin (if any)".
 */

import { execSync } from 'node:child_process';
import { spawnAgent } from './spawn-helper.js';
import type { AgentAdapter, AgentProcess, SpawnOptions } from './types.js';

export class GeminiAdapter implements AgentAdapter {
  name = 'gemini';

  async available(): Promise<boolean> {
    try {
      execSync('gemini --version', { stdio: 'ignore', timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  spawn(prompt: string, opts: SpawnOptions): AgentProcess {
    // Use stdin to avoid shell escaping issues with long prompts
    // -p "." activates headless mode (requires non-empty value); actual prompt piped via stdin
    // --yolo auto-approves actions (orchestrated agent should not block on confirmations)
    return spawnAgent('gemini', ['-p', '.', '--yolo'], opts, prompt);
  }
}
