/**
 * Codex CLI adapter.
 *
 * Invocation: codex "<prompt>"
 */

import { spawnAgentWithStream, isCommandAvailable } from './spawn-helper.js';
import { parseCodexStreamLine, createCodexStreamState } from './codex-stream.js';
import type { AgentAdapter, AgentProcess, SpawnOptions } from './types.js';

export class CodexAdapter implements AgentAdapter {
  name = 'codex';

  async available(): Promise<boolean> {
    return isCommandAvailable('codex');
  }

  spawn(prompt: string, opts: SpawnOptions): AgentProcess {
    const state = createCodexStreamState();

    // Use stdin ('-') to avoid shell escaping issues with long prompts
    // --dangerously-bypass-approvals-and-sandbox: auto-approve + full write access for orchestrated headless mode
    // --json: emit JSONL events to stdout for streaming + token tracking
    const args = opts.resumeSessionId
      ? ['exec', 'resume', opts.resumeSessionId, '--dangerously-bypass-approvals-and-sandbox', '--json', '-']
      : ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json', '-'];

    return spawnAgentWithStream(
      'codex',
      args,
      opts,
      prompt,
      (line) => parseCodexStreamLine(line, state),
      (result) => ({
        ...result,
        tokenUsage: Object.keys(state.usage).length > 0 ? { ...state.usage } : undefined,
        sessionId: state.sessionId,
      }),
    );
  }
}
