import { describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { ModernMcpRuntimePool, type ModernMcpRuntime } from '../../src/server/modern-mcp-bridge.js';

function runtimeFactory(counter: { created: number; closed: number }): () => Promise<ModernMcpRuntime> {
  return async () => {
    counter.created++;
    return {
      projectId: 'org/repo',
      getProjectDataDir: () => 'C:/data',
      createBridge: () => new McpServer({ name: 'pool-test', version: '1' }) as never,
      close: async () => { counter.closed++; },
    };
  };
}

describe('modern MCP runtime pool', () => {
  it('reuses business runtime while issuing independent request bridges', async () => {
    const counter = { created: 0, closed: 0 };
    const pool = new ModernMcpRuntimePool(0);
    const create = runtimeFactory(counter);

    const first = await pool.createBridge('project-a', create);
    const second = await pool.createBridge('project-a', create);
    expect(counter.created).toBe(1);
    expect(pool.stats()).toMatchObject({ entries: 1, activeRefs: 2 });

    await first.close();
    expect(counter.closed).toBe(0);
    await second.close();
    expect(pool.stats()).toMatchObject({ entries: 1, activeRefs: 0 });

    expect(await pool.evictIdle()).toBe(1);
    expect(counter.closed).toBe(1);
  });

  it('keeps runtimes separate when projects share the flat data directory', async () => {
    const counter = { created: 0, closed: 0 };
    const pool = new ModernMcpRuntimePool(32);
    const create = runtimeFactory(counter);

    const first = await pool.createBridge(JSON.stringify(['C:/data', 'C:/repo-a']), create);
    const second = await pool.createBridge(JSON.stringify(['C:/data', 'C:/repo-b']), create);

    expect(counter.created).toBe(2);
    expect(pool.stats()).toMatchObject({ entries: 2, activeRefs: 2 });

    await first.close();
    await second.close();
    await pool.close();
    expect(counter.closed).toBe(2);
  });
});
