import { describe, it, expect, beforeEach } from 'vitest';
import { parseCodexStreamLine, createCodexStreamState, type CodexStreamState } from '../../src/orchestrate/adapters/codex-stream.js';
import { parseGeminiStreamLine, createGeminiStreamState, type GeminiStreamState } from '../../src/orchestrate/adapters/gemini-stream.js';
import { parseOpenCodeStreamLine, createOpenCodeStreamState, type OpenCodeStreamState } from '../../src/orchestrate/adapters/opencode-stream.js';

// ═══════════════════════════════════════════════════════════
// Codex
// ═══════════════════════════════════════════════════════════

describe('parseCodexStreamLine', () => {
  let state: CodexStreamState;
  const parse = (raw: string) => parseCodexStreamLine(raw, state);

  beforeEach(() => { state = createCodexStreamState(); });

  it('should return empty for blank lines', () => {
    expect(parse('')).toEqual([]);
    expect(parse('   ')).toEqual([]);
  });

  it('should return empty for invalid JSON', () => {
    expect(parse('not json')).toEqual([]);
  });

  it('should capture thread_id from thread.started', () => {
    parse('{"type":"thread.started","thread_id":"thr-123"}');
    expect(state.sessionId).toBe('thr-123');
  });

  it('should parse agent_message from item.completed', () => {
    const msgs = parse('{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hello"}}');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ type: 'text', content: 'hello' });
  });

  it('should parse tool_call from item.completed', () => {
    const msgs = parse(JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_1', type: 'tool_call', name: 'read_file', call_id: 'call_1', arguments: '{"path":"a.txt"}' },
    }));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('tool_use');
    expect(msgs[0].tool).toBe('read_file');
    expect(msgs[0].callId).toBe('call_1');
  });

  it('should parse tool_output from item.completed', () => {
    const msgs = parse(JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_2', type: 'tool_output', call_id: 'call_1', output: 'file contents' },
    }));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('tool_result');
    expect(msgs[0].output).toBe('file contents');
  });

  it('should extract token usage from turn.completed', () => {
    parse('{"type":"turn.completed","usage":{"input_tokens":30000,"output_tokens":100,"cached_input_tokens":4096}}');
    expect(state.usage['codex']).toEqual({
      inputTokens: 30000,
      outputTokens: 100,
      cacheReadTokens: 4096,
      cacheWriteTokens: 0,
      model: 'codex',
    });
  });

  it('should handle error events', () => {
    const msgs = parseCodexStreamLine('{"type":"error","message":"something broke"}', state);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('error');
    expect(state.isError).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// Gemini
// ═══════════════════════════════════════════════════════════

describe('parseGeminiStreamLine', () => {
  let state: GeminiStreamState;
  const parse = (raw: string) => parseGeminiStreamLine(raw, state);

  beforeEach(() => { state = createGeminiStreamState(); });

  it('should return empty for blank lines', () => {
    expect(parse('')).toEqual([]);
  });

  it('should capture session_id from init', () => {
    parse('{"type":"init","session_id":"sess-abc","model":"gemini-3"}');
    expect(state.sessionId).toBe('sess-abc');
  });

  it('should strip MCP warning prefix before JSON', () => {
    parse('MCP issues detected. Run /mcp list for status.{"type":"init","session_id":"sess-123"}');
    expect(state.sessionId).toBe('sess-123');
  });

  it('should parse assistant text from message', () => {
    const msgs = parse('{"type":"message","role":"assistant","content":"hello","delta":true}');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ type: 'text', content: 'hello' });
  });

  it('should skip user messages', () => {
    const msgs = parse('{"type":"message","role":"user","content":"prompt"}');
    expect(msgs).toEqual([]);
  });

  it('should parse tool_use with tool_name and tool_id', () => {
    const msgs = parse(JSON.stringify({
      type: 'tool_use',
      tool_name: 'read_file',
      tool_id: 'read_1',
      parameters: { file_path: 'a.txt' },
    }));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('tool_use');
    expect(msgs[0].tool).toBe('read_file');
    expect(msgs[0].callId).toBe('read_1');
  });

  it('should parse tool_result with tool_id', () => {
    const msgs = parse(JSON.stringify({
      type: 'tool_result',
      tool_id: 'read_1',
      status: 'success',
      output: 'file contents',
    }));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('tool_result');
    expect(msgs[0].callId).toBe('read_1');
    expect(msgs[0].output).toBe('file contents');
  });

  it('should extract per-model token usage from result.stats.models', () => {
    parse(JSON.stringify({
      type: 'result',
      status: 'success',
      stats: {
        total_tokens: 20000,
        input_tokens: 19000,
        output_tokens: 1000,
        models: {
          'gemini-3-flash': { input_tokens: 15000, output_tokens: 800, cached: 5000 },
          'gemini-2.5-lite': { input_tokens: 4000, output_tokens: 200, cached: 0 },
        },
      },
    }));
    expect(Object.keys(state.usage)).toHaveLength(2);
    expect(state.usage['gemini-3-flash']).toEqual({
      inputTokens: 15000, outputTokens: 800, cacheReadTokens: 5000, cacheWriteTokens: 0, model: 'gemini-3-flash',
    });
    expect(state.usage['gemini-2.5-lite']).toEqual({
      inputTokens: 4000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, model: 'gemini-2.5-lite',
    });
  });

  it('should fallback to aggregate stats when no per-model breakdown', () => {
    parse(JSON.stringify({
      type: 'result',
      stats: { input_tokens: 5000, output_tokens: 100, cached: 2000 },
    }));
    expect(state.usage['gemini']).toEqual({
      inputTokens: 5000, outputTokens: 100, cacheReadTokens: 2000, cacheWriteTokens: 0, model: 'gemini',
    });
  });

  it('should handle error events', () => {
    const msgs = parse('{"type":"error","error":"timeout"}');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('error');
    expect(msgs[0].content).toBe('timeout');
    expect(state.isError).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// OpenCode
// ═══════════════════════════════════════════════════════════

describe('parseOpenCodeStreamLine', () => {
  let state: OpenCodeStreamState;
  const parse = (raw: string) => parseOpenCodeStreamLine(raw, state);

  beforeEach(() => { state = createOpenCodeStreamState(); });

  it('should return empty for blank lines', () => {
    expect(parse('')).toEqual([]);
  });

  it('should capture sessionID from first event', () => {
    parse('{"type":"step_start","sessionID":"ses_abc123","part":{"type":"step-start"}}');
    expect(state.sessionId).toBe('ses_abc123');
  });

  it('should parse text from text event', () => {
    const msgs = parse(JSON.stringify({
      type: 'text',
      sessionID: 'ses_1',
      part: { type: 'text', text: 'hello world' },
    }));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ type: 'text', content: 'hello world' });
  });

  it('should parse tool call from tool event (pending)', () => {
    const msgs = parse(JSON.stringify({
      type: 'tool',
      sessionID: 'ses_1',
      part: { id: 'prt_1', tool: 'read_file', state: { status: 'pending' } },
    }));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('tool_use');
    expect(msgs[0].tool).toBe('read_file');
  });

  it('should parse tool result from tool event (completed)', () => {
    const msgs = parse(JSON.stringify({
      type: 'tool',
      sessionID: 'ses_1',
      part: { id: 'prt_1', tool: 'read_file', state: { status: 'completed', output: 'file data' } },
    }));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('tool_result');
    expect(msgs[0].output).toBe('file data');
  });

  it('should extract token usage from step_finish', () => {
    parse(JSON.stringify({
      type: 'step_finish',
      sessionID: 'ses_1',
      part: {
        type: 'step-finish',
        reason: 'stop',
        tokens: { total: 16000, input: 15000, output: 1000, reasoning: 0, cache: { read: 5000, write: 100 } },
      },
    }));
    expect(state.usage['opencode']).toEqual({
      inputTokens: 15000,
      outputTokens: 1000,
      cacheReadTokens: 5000,
      cacheWriteTokens: 100,
      model: 'opencode',
    });
  });

  it('should handle error events', () => {
    const msgs = parse(JSON.stringify({
      type: 'error',
      sessionID: 'ses_1',
      part: { text: 'something failed' },
    }));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('error');
    expect(state.isError).toBe(true);
  });
});
