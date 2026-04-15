/**
 * Claude Code CLI adapter.
 *
 * Invocation: claude -p - --output-format stream-json --verbose --permission-mode bypassPermissions
 *
 * Uses stream-json output format for:
 *   - Real-time tool_use / text / thinking events
 *   - Token usage tracking per model
 *   - Session ID capture for future session reuse
 */

import { spawnAgentWithStream, isCommandAvailable } from './spawn-helper.js';
import { parseClaudeStreamLine, createStreamState } from './claude-stream.js';
import type { AgentAdapter, AgentProcess, SpawnOptions } from './types.js';

export class ClaudeAdapter implements AgentAdapter {
  name = 'claude';

  async available(): Promise<boolean> {
    return isCommandAvailable('claude');
  }

  spawn(prompt: string, opts: SpawnOptions): AgentProcess {
    const state = createStreamState();

    const args = ['-p', '-', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions'];
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
