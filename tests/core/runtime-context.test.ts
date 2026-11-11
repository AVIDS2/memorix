import { describe, expect, it } from 'vitest';
import { createRuntimeContext } from '../../src/core/runtime-context.js';

describe('runtime context boundary', () => {
  it('rejects an unresolved project and snapshots config for one request', () => {
    const config = { codegraph: { autoRefresh: 'never', excludePatterns: ['generated/**'] } } as any;
    expect(() => createRuntimeContext({ projectId: '', projectRoot: '.', dataDir: '.', config })).toThrow();

    const context = createRuntimeContext({
      projectId: 'org/repo', projectRoot: '.', dataDir: '.', config,
    });
    config.codegraph.excludePatterns.push('secret/**');
    config.codegraph.autoRefresh = 'always';

    expect(context.projectId).toBe('org/repo');
    expect(context.config.codegraph.autoRefresh).toBe('never');
    expect(context.config.codegraph.excludePatterns).toEqual(['generated/**']);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.config.codegraph)).toBe(true);
  });
});
