/**
 * Gemini CLI stream-json parser.
 *
 * Parses NDJSON from `gemini --output-format stream-json`
 * into AgentMessage events.
 *
 * Event types (from real gemini-cli 0.37.1 output):
 *   - "init"        → session_id, model
 *   - "message"     → role=user|assistant, content
 *   - "tool_use"    → tool call requests
 *   - "tool_result" → tool output
 *   - "error"       → warnings/errors
 *   - "result"      → final stats with per-model token usage
 *
 * Note: Gemini may prefix MCP warnings before JSON on the init line.
 * The parser strips leading non-JSON text before parsing.
 */

import type { AgentMessage, TokenUsage } from './types.js';

// ── Gemini stream-json shapes ───────────────────────────────

interface GeminiStreamLine {
  type: string;
  timestamp?: string;
  session_id?: string;
  model?: string;
  role?: string;
  content?: string;
  delta?: boolean;
  name?: string;
  tool_name?: string;
  arguments?: unknown;
  parameters?: unknown;
  call_id?: string;
  tool_id?: string;
  tool_use_id?: string;
  output?: string;
  status?: string;
  error?: string;
  stats?: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    cached?: number;
    duration_ms?: number;
    tool_calls?: number;
    models?: Record<string, {
      total_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
      cached?: number;
    }>;
  };
}

// ── State ───────────────────────────────────────────────────

export interface GeminiStreamState {
  sessionId?: string;
  usage: Record<string, TokenUsage>;
  isError: boolean;
}

// ── Parser ──────────────────────────────────────────────────

/**
 * Parse a single NDJSON line from Gemini stream-json output.
 * Returns zero or more AgentMessage events.
 */
export function parseGeminiStreamLine(
  raw: string,
  state: GeminiStreamState,
): AgentMessage[] {
  let line = raw.trim();
  if (!line) return [];

  // Gemini may prefix MCP warning text before JSON on init line:
  // "MCP issues detected. Run /mcp list for status.{"type":"init",...}"
  const jsonStart = line.indexOf('{');
  if (jsonStart > 0) {
    line = line.slice(jsonStart);
  }

  let parsed: GeminiStreamLine;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }

  const messages: AgentMessage[] = [];

  switch (parsed.type) {
    case 'init':
      if (parsed.session_id) {
        state.sessionId = parsed.session_id;
      }
      break;

    case 'message':
      if (parsed.role === 'assistant' && parsed.content) {
        messages.push({ type: 'text', content: parsed.content });
      }
      break;

    case 'tool_use':
      messages.push({
        type: 'tool_use',
        tool: parsed.tool_name ?? parsed.name ?? 'unknown',
        callId: parsed.tool_id ?? parsed.call_id,
        input: (parsed.parameters ?? parsed.arguments) as Record<string, unknown> | undefined,
      });
      break;

    case 'tool_result':
      messages.push({
        type: 'tool_result',
        callId: parsed.tool_id ?? parsed.tool_use_id ?? parsed.call_id,
        output: parsed.output
          ? (parsed.output.length > 4096 ? parsed.output.slice(0, 4096) : parsed.output)
          : parsed.content
            ? (parsed.content.length > 4096 ? parsed.content.slice(0, 4096) : parsed.content)
            : undefined,
      });
      break;

    case 'error':
      state.isError = true;
      messages.push({ type: 'error', content: parsed.error ?? parsed.content ?? 'Unknown error' });
      break;

    case 'result':
      // Extract per-model token usage from stats.models
      if (parsed.stats?.models) {
        for (const [model, mu] of Object.entries(parsed.stats.models)) {
          state.usage[model] = {
            inputTokens: mu.input_tokens ?? 0,
            outputTokens: mu.output_tokens ?? 0,
            cacheReadTokens: mu.cached ?? 0,
            cacheWriteTokens: 0,
            model,
          };
        }
      } else if (parsed.stats) {
        // Fallback: aggregate stats without per-model breakdown
        state.usage['gemini'] = {
          inputTokens: parsed.stats.input_tokens ?? 0,
          outputTokens: parsed.stats.output_tokens ?? 0,
          cacheReadTokens: parsed.stats.cached ?? 0,
          cacheWriteTokens: 0,
          model: 'gemini',
        };
      }
      break;
  }

  return messages;
}

/**
 * Create a fresh parser state.
 */
export function createGeminiStreamState(): GeminiStreamState {
  return { usage: {}, isError: false };
}
