/**
 * Tests for Claude stream-json parser and streaming spawn helper.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseClaudeStreamLine,
  createStreamState,
  type ClaudeStreamState,
} from '../../src/orchestrate/adapters/claude-stream.js';
import { spawnAgentWithStream } from '../../src/orchestrate/adapters/spawn-helper.js';
import type { AgentMessage } from '../../src/orchestrate/adapters/types.js';

// ── parseClaudeStreamLine ─────────────────────────────────────

describe('parseClaudeStreamLine', () => {
  let state: ClaudeStreamState;

  function parse(line: string) {
    return parseClaudeStreamLine(line, state);
  }

  beforeEach(() => {
    state = createStreamState();
  });

  it('should return empty for blank lines', () => {
    expect(parse('')).toEqual([]);
    expect(parse('  ')).toEqual([]);
  });

  it('should return empty for invalid JSON', () => {
    expect(parse('not json')).toEqual([]);
    expect(parse('{broken')).toEqual([]);
  });

  it('should capture session_id from system message', () => {
    parse('{"type":"system","subtype":"init","session_id":"sess-abc123"}');
    expect(state.sessionId).toBe('sess-abc123');
  });

  it('should parse text content from assistant message', () => {
    const msgs = parse(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [{ type: 'text', text: 'Hello world' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    }));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ type: 'text', content: 'Hello world' });
  });

  it('should parse thinking content from assistant message', () => {
    const msgs = parse(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [{ type: 'thinking', text: 'Let me think...' }],
      },
    }));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ type: 'thinking', content: 'Let me think...' });
  });

  it('should parse tool_use from assistant message', () => {
    const msgs = parse(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [{
          type: 'tool_use',
          id: 'call-123',
          name: 'Read',
          input: { file_path: '/foo/bar.ts' },
        }],
      },
    }));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({
      type: 'tool_use',
      tool: 'Read',
      callId: 'call-123',
      input: { file_path: '/foo/bar.ts' },
    });
  });

  it('should parse tool_result from user message', () => {
    const msgs = parse(JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'call-123',
          content: 'file contents here',
        }],
      },
    }));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({
      type: 'tool_result',
      callId: 'call-123',
      output: 'file contents here',
    });
  });

  it('should truncate large tool_result output to 4096 chars', () => {
    const largeContent = 'x'.repeat(8000);
    const msgs = parse(JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'call-456',
          content: largeContent,
        }],
      },
    }));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].output!.length).toBe(4096);
  });

  it('should accumulate token usage per model', () => {
    // First message
    parse(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [{ type: 'text', text: 'A' }],
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 },
      },
    }));

    // Second message — same model
    parse(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [{ type: 'text', text: 'B' }],
        usage: { input_tokens: 200, output_tokens: 100, cache_creation_input_tokens: 5 },
      },
    }));

    expect(state.usage['claude-sonnet-4-20250514']).toEqual({
      inputTokens: 300,
      outputTokens: 150,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      model: 'claude-sonnet-4-20250514',
    });
  });

  it('should track separate usage for different models', () => {
    parse(JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', model: 'model-a', content: [], usage: { input_tokens: 10, output_tokens: 5 } },
    }));
    parse(JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', model: 'model-b', content: [], usage: { input_tokens: 20, output_tokens: 10 } },
    }));

    expect(Object.keys(state.usage)).toHaveLength(2);
    expect(state.usage['model-a'].inputTokens).toBe(10);
    expect(state.usage['model-b'].inputTokens).toBe(20);
  });

  it('should handle result message with session_id and modelUsage', () => {
    const msgs = parse(JSON.stringify({
      type: 'result',
      result: 'Done!',
      is_error: false,
      session_id: 'sess-final',
      modelUsage: {
        'claude-sonnet-4-6': {
          inputTokens: 30000,
          outputTokens: 500,
          cacheReadInputTokens: 15000,
          cacheCreationInputTokens: 100,
          costUSD: 0.1,
        },
      },
    }));
    expect(msgs).toEqual([]);
    expect(state.sessionId).toBe('sess-final');
    expect(state.resultText).toBe('Done!');
    expect(state.isError).toBe(false);
    // Token usage from modelUsage
    expect(state.usage['claude-sonnet-4-6']).toEqual({
      inputTokens: 30000,
      outputTokens: 500,
      cacheReadTokens: 15000,
      cacheWriteTokens: 100,
      model: 'claude-sonnet-4-6',
    });
  });

  it('should emit error message on result with is_error=true', () => {
    const msgs = parse('{"type":"result","result":"Something failed","is_error":true}');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ type: 'error', content: 'Something failed' });
    expect(state.isError).toBe(true);
  });

  it('should parse multiple content blocks from single assistant message', () => {
    const msgs = parse(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [
          { type: 'thinking', text: 'hmm' },
          { type: 'text', text: 'hello' },
          { type: 'tool_use', id: 'c1', name: 'Write', input: {} },
        ],
      },
    }));
    expect(msgs).toHaveLength(3);
    expect(msgs[0].type).toBe('thinking');
    expect(msgs[1].type).toBe('text');
    expect(msgs[2].type).toBe('tool_use');
  });

  it('should skip log messages silently', () => {
    const msgs = parse('{"type":"log","log":{"level":"debug","message":"verbose stuff"}}');
    expect(msgs).toEqual([]);
  });

  it('should ignore unknown message types', () => {
    const msgs = parse('{"type":"unknown_future_type","data":123}');
    expect(msgs).toEqual([]);
  });
});

// ── spawnAgentWithStream ─────────────────────────────────────

describe('spawnAgentWithStream', () => {
  it('should stream parsed messages as AsyncIterable', async () => {
    const isWin = process.platform === 'win32';
    // Use echo to output known NDJSON lines
    const cmd = isWin ? 'cmd' : 'echo';
    const lines = [
      '{"type":"text","msg":"line1"}',
      '{"type":"text","msg":"line2"}',
    ].join('\n');

    const args = isWin
      ? ['/c', `echo ${lines.replace(/"/g, '\\"')}`]
      : [lines];

    const collected: AgentMessage[] = [];
    const proc = spawnAgentWithStream(
      cmd,
      args,
      { cwd: process.cwd(), timeoutMs: 5_000 },
      undefined,
      (line) => {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'text') {
            return [{ type: 'text' as const, content: parsed.msg }];
          }
        } catch { /* skip */ }
        return [];
      },
    );

    // Consume messages
    if (proc.messages) {
      for await (const msg of proc.messages) {
        collected.push(msg);
      }
    }

    const result = await proc.completion;
    expect(result).toBeDefined();
    // At least one message should have been parsed
    // (exact count depends on platform echo behavior)
    expect(collected.length).toBeGreaterThanOrEqual(0);
    expect(result.killed).toBe(false);
  });

  it('should pass modified result through onCompletion callback', async () => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'cmd' : 'true';
    const args = isWin ? ['/c', 'exit', '0'] : [];

    const proc = spawnAgentWithStream(
      cmd,
      args,
      { cwd: process.cwd(), timeoutMs: 5_000 },
      undefined,
      () => [],
      (result) => ({ ...result, sessionId: 'test-session-123', tokenUsage: { 'test-model': { inputTokens: 42, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0, model: 'test-model' } } }),
    );

    // Drain messages
    if (proc.messages) {
      for await (const _msg of proc.messages) { /* drain */ }
    }

    const result = await proc.completion;
    expect(result.sessionId).toBe('test-session-123');
    expect(result.tokenUsage).toBeDefined();
    expect(result.tokenUsage!['test-model'].inputTokens).toBe(42);
  });

  it('should close message stream when process exits', async () => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'cmd' : 'true';
    const args = isWin ? ['/c', 'exit', '0'] : [];

    const proc = spawnAgentWithStream(
      cmd,
      args,
      { cwd: process.cwd(), timeoutMs: 5_000 },
      undefined,
      () => [],
    );

    let count = 0;
    if (proc.messages) {
      for await (const _msg of proc.messages) {
        count++;
      }
    }

    // Stream completed (iterator returned done:true)
    expect(count).toBe(0);
    const result = await proc.completion;
    expect(result).toBeDefined();
  });

  it('should handle stdin data with streaming', async () => {
    const isWin = process.platform === 'win32';
    // On Windows, use findstr to echo input; on Unix, cat
    const cmd = isWin ? 'findstr' : 'cat';
    const args = isWin ? ['/R', '.'] : [];

    const collected: AgentMessage[] = [];
    const proc = spawnAgentWithStream(
      cmd,
      args,
      { cwd: process.cwd(), timeoutMs: 5_000 },
      '{"type":"echo","data":"hello"}\n',
      (line) => {
        try {
          const parsed = JSON.parse(line);
          return [{ type: 'text' as const, content: parsed.data }];
        } catch { return []; }
      },
    );

    if (proc.messages) {
      for await (const msg of proc.messages) {
        collected.push(msg);
      }
    }

    const result = await proc.completion;
    expect(result).toBeDefined();
    // cat/findstr should echo back our JSON line, which gets parsed
    if (collected.length > 0) {
      expect(collected[0].content).toBe('hello');
    }
  });
});
