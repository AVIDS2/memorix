import { describe, expect, it } from 'vitest';

import { BOOTSTRAP_SAFE_TOOL_NAMES, shouldAwaitProjectRuntime } from '../../src/server.js';

describe('MCP bootstrap-safe tools', () => {
  it('allows only project-scoped read tools before full memory hydration', () => {
    expect([...BOOTSTRAP_SAFE_TOOL_NAMES].sort()).toEqual([
      'memorix_codegraph_status',
      'memorix_context_pack',
      'memorix_graph_context',
      'memorix_project_context',
    ]);
    expect(shouldAwaitProjectRuntime('memorix_project_context')).toBe(false);
    expect(shouldAwaitProjectRuntime('memorix_codegraph_status')).toBe(false);
    expect(shouldAwaitProjectRuntime('memorix_graph_context')).toBe(false);
    expect(shouldAwaitProjectRuntime('memorix_context_pack')).toBe(false);
  });

  it('keeps search, writes, and session operations behind full runtime initialization', () => {
    for (const tool of ['memorix_search', 'memorix_store', 'memorix_session_start']) {
      expect(shouldAwaitProjectRuntime(tool)).toBe(true);
    }
  });
});
