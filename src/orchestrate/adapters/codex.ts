/**
 * Codex CLI adapter.
 *
 * Invocation: codex "<prompt>"
 */

import { execSync } from 'node:child_process';
import { spawnAgent } from './spawn-helper.js';
import type { AgentAdapter, AgentProcess, SpawnOptions } from './types.js';

export class CodexAdapter implements AgentAdapter {
  name = 'codex';

  async available(): Promise<boolean> {
    try {
      execSync('codex --version', { stdio: 'ignore', timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  spawn(prompt: string, opts: SpawnOptions): AgentProcess {
    // Use stdin ('-') to avoid shell escaping issues with long prompts
    // --dangerously-bypass-approvals-and-sandbox: auto-approve + full write access for orchestrated headless mode
    // (--full-auto forces read-only sandbox which blocks file creation)
    return spawnAgent('codex', ['exec', '--dangerously-bypass-approvals-and-sandbox', '-'], opts, prompt);
  }
}
