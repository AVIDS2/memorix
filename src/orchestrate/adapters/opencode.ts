/**
 * OpenCode CLI adapter.
 *
 * Invocation: opencode -p "<prompt>"
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
    return spawnAgent('opencode', ['-p', prompt], opts);
  }
}
