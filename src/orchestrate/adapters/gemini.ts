/**
 * Gemini CLI adapter.
 *
 * Invocation: echo "<prompt>" | gemini --yolo
 * Headless mode is automatically triggered when stdin is piped (non-TTY).
 * No -p flag needed — it would append its value to stdin, polluting the prompt.
 * Ref: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md
 */

import { spawnAgentWithStream, isCommandAvailable } from './spawn-helper.js';
import { parseGeminiStreamLine, createGeminiStreamState } from './gemini-stream.js';
import type { AgentAdapter, AgentProcess, SpawnOptions } from './types.js';

export class GeminiAdapter implements AgentAdapter {
  name = 'gemini';

  async available(): Promise<boolean> {
    return isCommandAvailable('gemini');
  }

  spawn(prompt: string, opts: SpawnOptions): AgentProcess {
    const state = createGeminiStreamState();

    // Prompt piped via stdin — Gemini auto-enters headless mode in non-TTY.
    // --yolo auto-approves all tool calls (no interactive confirmations).
    // --output-format stream-json: emit NDJSON events for streaming + token tracking.
    const args = ['--yolo', '--output-format', 'stream-json'];

    return spawnAgentWithStream(
      'gemini',
      args,
      opts,
      prompt,
      (line) => parseGeminiStreamLine(line, state),
      (result) => ({
        ...result,
        tokenUsage: Object.keys(state.usage).length > 0 ? { ...state.usage } : undefined,
        sessionId: state.sessionId,
      }),
    );
  }
}
