/**
 * Gemini CLI adapter.
 *
 * Invocation: gemini "<prompt>"
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
    return spawnAgent('gemini', [prompt], opts);
  }
}
