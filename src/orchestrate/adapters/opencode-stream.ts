/**
 * OpenCode CLI JSON parser.
 *
 * Parses NDJSON from `opencode run --format json`
 * into AgentMessage events.
 *
 * Event types (from real opencode 1.2.27 output):
 *   - "step_start"  → snapshot, sessionID
 *   - "text"        → part.text
 *   - "tool"        → part.tool (tool name), part.state
 *   - "step_finish" → part.tokens (usage), part.reason
 */

import type { AgentMessage, TokenUsage } from './types.js';

// ── OpenCode JSON shapes ────────────────────────────────────

interface OpenCodeEvent {
  type: string;
  timestamp?: number;
  sessionID?: string;
  part?: {
    id?: string;
    sessionID?: string;
    messageID?: string;
    type?: string;
    text?: string;
    tool?: string;
    state?: {
      status?: string;
      output?: string;
    };
    reason?: string;
    cost?: number;
    tokens?: {
      total?: number;
      input?: number;
      output?: number;
      reasoning?: number;
      cache?: {
        read?: number;
        write?: number;
      };
    };
  };
}

// ── State ───────────────────────────────────────────────────

export interface OpenCodeStreamState {
  sessionId?: string;
  usage: Record<string, TokenUsage>;
  isError: boolean;
}

// ── Parser ──────────────────────────────────────────────────

/**
 * Parse a single NDJSON line from OpenCode --format json output.
 * Returns zero or more AgentMessage events.
 */
export function parseOpenCodeStreamLine(
  raw: string,
  state: OpenCodeStreamState,
): AgentMessage[] {
  const line = raw.trim();
  if (!line) return [];

  let parsed: OpenCodeEvent;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }

  const messages: AgentMessage[] = [];

  // Capture sessionID from any event
  if (parsed.sessionID && !state.sessionId) {
    state.sessionId = parsed.sessionID;
  }

  switch (parsed.type) {
    case 'text':
      if (parsed.part?.text) {
        messages.push({ type: 'text', content: parsed.part.text });
      }
      break;

    case 'tool':
      if (parsed.part?.tool) {
        if (parsed.part.state?.status === 'completed' || parsed.part.state?.status === 'error') {
          // Tool result
          const output = parsed.part.state.output;
          messages.push({
            type: 'tool_result',
            callId: parsed.part.id,
            output: output
              ? (output.length > 4096 ? output.slice(0, 4096) : output)
              : undefined,
          });
        } else {
          // Tool call (pending/running)
          messages.push({
            type: 'tool_use',
            tool: parsed.part.tool,
            callId: parsed.part.id,
          });
        }
      }
      break;

    case 'step_finish':
      // Extract token usage
      if (parsed.part?.tokens) {
        const t = parsed.part.tokens;
        // OpenCode doesn't expose model name in CLI output, use generic key
        const model = 'opencode';
        state.usage[model] = {
          inputTokens: t.input ?? 0,
          outputTokens: t.output ?? 0,
          cacheReadTokens: t.cache?.read ?? 0,
          cacheWriteTokens: t.cache?.write ?? 0,
          model,
        };
      }
      break;

    case 'error':
      state.isError = true;
      messages.push({ type: 'error', content: parsed.part?.text ?? 'Unknown error' });
      break;
  }

  return messages;
}

/**
 * Create a fresh parser state.
 */
export function createOpenCodeStreamState(): OpenCodeStreamState {
  return { usage: {}, isError: false };
}
