/**
 * Claude Code stream-json parser.
 *
 * Parses NDJSON from `claude -p --output-format stream-json --verbose`
 * into AgentMessage events. Based on observed format from Multica reference
 * and Claude Code documentation.
 *
 * Message types:
 *   - "system"    → session_id, status
 *   - "assistant" → content blocks (text, thinking, tool_use) + usage
 *   - "user"      → tool_result content blocks
 *   - "result"    → final result text, is_error, session_id
 *   - "log"       → debug/info log entries
 */

import type { AgentMessage, TokenUsage } from './types.js';

// ── Claude SDK JSON shapes ──────────────────────────────────────

interface ClaudeStreamLine {
  type: string;
  message?: unknown;
  subtype?: string;
  session_id?: string;
  result?: string;
  is_error?: boolean;
  duration_ms?: number;
  num_turns?: number;
  log?: { level: string; message: string };
  /** Per-model token usage — only present on 'result' messages */
  modelUsage?: Record<string, {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    costUSD?: number;
  }>;
}

interface ClaudeMessageContent {
  role: string;
  model?: string;
  content?: ClaudeContentBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

interface ClaudeContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

// ── State ───────────────────────────────────────────────────────

export interface ClaudeStreamState {
  sessionId?: string;
  usage: Record<string, TokenUsage>;
  resultText?: string;
  isError: boolean;
}

// ── Parser ──────────────────────────────────────────────────────

/**
 * Parse a single NDJSON line from Claude stream-json output.
 * Returns zero or more AgentMessage events.
 */
export function parseClaudeStreamLine(
  raw: string,
  state: ClaudeStreamState,
): AgentMessage[] {
  const line = raw.trim();
  if (!line) return [];

  let parsed: ClaudeStreamLine;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }

  const messages: AgentMessage[] = [];

  switch (parsed.type) {
    case 'system':
      if (parsed.session_id) {
        state.sessionId = parsed.session_id;
      }
      break;

    case 'assistant':
      if (parsed.message) {
        const content = parsed.message as ClaudeMessageContent;
        // Accumulate usage
        if (content.usage && content.model) {
          const model = content.model;
          const prev = state.usage[model] ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, model };
          prev.inputTokens += content.usage.input_tokens ?? 0;
          prev.outputTokens += content.usage.output_tokens ?? 0;
          prev.cacheReadTokens += content.usage.cache_read_input_tokens ?? 0;
          prev.cacheWriteTokens += content.usage.cache_creation_input_tokens ?? 0;
          state.usage[model] = prev;
        }
        // Parse content blocks
        for (const block of content.content ?? []) {
          switch (block.type) {
            case 'text':
              if (block.text) {
                messages.push({ type: 'text', content: block.text });
              }
              break;
            case 'thinking':
              if (block.text) {
                messages.push({ type: 'thinking', content: block.text });
              }
              break;
            case 'tool_use':
              messages.push({
                type: 'tool_use',
                tool: block.name ?? 'unknown',
                callId: block.id,
                input: typeof block.input === 'object' && block.input !== null
                  ? block.input as Record<string, unknown>
                  : undefined,
              });
              break;
          }
        }
      }
      break;

    case 'user':
      if (parsed.message) {
        const content = parsed.message as ClaudeMessageContent;
        for (const block of content.content ?? []) {
          if (block.type === 'tool_result') {
            const output = block.content != null ? String(block.content) : '';
            messages.push({
              type: 'tool_result',
              callId: block.tool_use_id,
              output: output.length > 4096 ? output.slice(0, 4096) : output,
            });
          }
        }
      }
      break;

    case 'result':
      if (parsed.session_id) state.sessionId = parsed.session_id;
      if (parsed.result) state.resultText = parsed.result;
      if (parsed.is_error) {
        state.isError = true;
        messages.push({ type: 'error', content: parsed.result ?? 'Unknown error' });
      }
      // Extract real token usage from result.modelUsage (per-model, camelCase)
      // Note: assistant message usage fields are always 0 during streaming
      if (parsed.modelUsage) {
        for (const [model, mu] of Object.entries(parsed.modelUsage)) {
          state.usage[model] = {
            inputTokens: mu.inputTokens ?? 0,
            outputTokens: mu.outputTokens ?? 0,
            cacheReadTokens: mu.cacheReadInputTokens ?? 0,
            cacheWriteTokens: mu.cacheCreationInputTokens ?? 0,
            model,
          };
        }
      }
      break;

    case 'log':
      // Skip debug noise — only surface warnings/errors
      break;
  }

  return messages;
}

/**
 * Create a fresh parser state.
 */
export function createStreamState(): ClaudeStreamState {
  return { usage: {}, isError: false };
}
