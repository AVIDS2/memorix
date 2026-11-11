/**
 * Codex CLI JSONL parser.
 *
 * Parses NDJSON from `codex exec --json`
 * into AgentMessage events.
 *
 * Event types (from real codex-cli 0.97.0 output):
 *   - "thread.started" → thread_id (session)
 *   - "turn.started"   → turn begins
 *   - "item.completed" → agent_message / tool_call / tool_result items
 *   - "turn.completed" → usage summary
 */

import type { AgentMessage, TokenUsage } from './types.js';

// ── Codex JSONL shapes ──────────────────────────────────────

interface CodexEvent {
  type: string;
  thread_id?: string;
  item?: {
    id?: string;
    type?: string;
    text?: string;
    name?: string;
    arguments?: string;
    output?: string;
    call_id?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cached_input_tokens?: number;
  };
}

// ── State ───────────────────────────────────────────────────

export interface CodexStreamState {
  sessionId?: string;
  usage: Record<string, TokenUsage>;
  isError: boolean;
}

// ── Parser ──────────────────────────────────────────────────

/**
 * Parse a single NDJSON line from Codex --json output.
 * Returns zero or more AgentMessage events.
 */
export function parseCodexStreamLine(
  raw: string,
  state: CodexStreamState,
): AgentMessage[] {
  const line = raw.trim();
  if (!line) return [];

  let parsed: CodexEvent;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }

  const messages: AgentMessage[] = [];

  switch (parsed.type) {
    case 'thread.started':
      if (parsed.thread_id) {
        state.sessionId = parsed.thread_id;
      }
      break;

    case 'item.completed':
      if (parsed.item) {
        switch (parsed.item.type) {
          case 'agent_message':
            if (parsed.item.text) {
              messages.push({ type: 'text', content: parsed.item.text });
            }
            break;
          case 'tool_call':
          case 'function_call':
            messages.push({
              type: 'tool_use',
              tool: parsed.item.name ?? 'unknown',
              callId: parsed.item.call_id ?? parsed.item.id,
              input: parsed.item.arguments ? { raw: parsed.item.arguments } : undefined,
            });
            break;
          case 'tool_output':
          case 'function_call_output':
            messages.push({
              type: 'tool_result',
              callId: parsed.item.call_id ?? parsed.item.id,
              output: parsed.item.output
                ? (parsed.item.output.length > 4096 ? parsed.item.output.slice(0, 4096) : parsed.item.output)
                : undefined,
            });
            break;
        }
      }
      break;

    case 'turn.completed':
      // Extract token usage — Codex doesn't provide per-model breakdown,
      // so we use a generic "codex" model key
      if (parsed.usage) {
        const model = 'codex';
        state.usage[model] = {
          inputTokens: parsed.usage.input_tokens ?? 0,
          outputTokens: parsed.usage.output_tokens ?? 0,
          cacheReadTokens: parsed.usage.cached_input_tokens ?? 0,
          cacheWriteTokens: 0,
          model,
        };
      }
      break;

    case 'error':
      state.isError = true;
      messages.push({ type: 'error', content: String((parsed as unknown as Record<string, unknown>).message ?? 'Unknown error') });
      break;
  }

  return messages;
}

/**
 * Create a fresh parser state.
 */
export function createCodexStreamState(): CodexStreamState {
  return { usage: {}, isError: false };
}
