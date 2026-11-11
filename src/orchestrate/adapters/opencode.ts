/**
 * OpenCode CLI adapter.
 *
 * Invocation: echo "<prompt>" | opencode run
 * The `run` subcommand executes a one-shot task and exits.
 * Prompt is piped via stdin to avoid shell escaping issues.
 */

import { spawnAgentWithStream, isCommandAvailable } from './spawn-helper.js';
import { parseOpenCodeStreamLine, createOpenCodeStreamState } from './opencode-stream.js';
import type { AgentAdapter, AgentProcess, SpawnOptions } from './types.js';

export class OpenCodeAdapter implements AgentAdapter {
  name = 'opencode';

  async available(): Promise<boolean> {
    return isCommandAvailable('opencode');
  }

  spawn(prompt: string, opts: SpawnOptions): AgentProcess {
    const state = createOpenCodeStreamState();

    // `opencode run` reads prompt from stdin and runs non-interactively.
    // --dir sets the working directory for the agent.
    // --format json: emit JSONL events for streaming + token tracking.
    const args = ['run', '--format', 'json'];
    if (opts.cwd) {
      args.push('--dir', opts.cwd);
    }
    if (opts.resumeSessionId) {
      args.push('--session', opts.resumeSessionId);
    }

    return spawnAgentWithStream(
      'opencode',
      args,
      opts,
      prompt,
      (line) => parseOpenCodeStreamLine(line, state),
      (result) => ({
        ...result,
        tokenUsage: Object.keys(state.usage).length > 0 ? { ...state.usage } : undefined,
        sessionId: state.sessionId,
      }),
    );
  }
}
