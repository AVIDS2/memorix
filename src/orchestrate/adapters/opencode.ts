/**
 * OpenCode CLI adapter.
 *
 * Invocation: echo "<prompt>" | opencode -p "."
 * OpenCode's -p flag enables non-interactive mode; prompt piped via stdin
 * to avoid shell escaping and Windows command line length limits.
 */

import { execSync } from 'node:child_process';
import { spawnAgent } from './spawn-helper.js';
import type { AgentAdapter, AgentProcess, SpawnOptions } from './types.js';

export class OpenCodeAdapter implements AgentAdapter {
  name = 'opencode';

  async available(): Promise<boolean> {
    try {
      execSync('opencode --version', { stdio: 'ignore', timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  spawn(prompt: string, opts: SpawnOptions): AgentProcess {
    // Pipe prompt via stdin; -p "." triggers non-interactive mode with minimal arg
    return spawnAgent('opencode', ['-p', '.'], opts, prompt);
  }
}
