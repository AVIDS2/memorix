import { describe, expect, it } from 'vitest';
import { DerivedViewRegistry } from '../../src/core/derived-view-registry.js';

describe('DerivedViewRegistry', () => {
  it('reads registered views into a bounded named snapshot', () => {
    const registry = new DerivedViewRegistry<{ state: string }>();
    registry.register('fts', () => ({ state: 'ready' }));
    registry.register('orama', () => ({ state: 'missing' }));

    expect(registry.snapshot()).toEqual({
      fts: { state: 'ready' },
      orama: { state: 'missing' },
    });
  });

  it('replaces a view by name and removes it through the disposer', () => {
    const registry = new DerivedViewRegistry<{ generation: number }>();
    registry.register('lance', () => ({ generation: 1 }));
    const dispose = registry.register('lance', () => ({ generation: 2 }));

    expect(registry.snapshot()).toEqual({ lance: { generation: 2 } });
    dispose();
    expect(registry.snapshot()).toEqual({});
  });

  it('isolates reader failures as a view-local degraded receipt', () => {
    const registry = new DerivedViewRegistry<{ state: string; reason?: string }>();
    registry.register('codegraph', () => { throw new Error('secret path C:\\repo'); });

    expect(registry.snapshot()).toEqual({
      codegraph: { state: 'degraded', reason: 'derived view reader failed' },
    });
  });
});
