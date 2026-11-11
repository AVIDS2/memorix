import { describe, expect, it, vi } from 'vitest';

const detailedSearch = vi.hoisted(() => vi.fn());
const legacySearch = vi.hoisted(() => vi.fn(async () => []));
const cachedMode = vi.hoisted(() => vi.fn(() => 'wrong concurrent mode'));

vi.mock('../../src/store/orama-store.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/store/orama-store.js')>(),
  searchObservationsDetailed: detailedSearch,
  searchObservations: legacySearch,
  getLastSearchMode: cachedMode,
}));

import { probeSearchIndex } from '../../src/memory/observations.js';

describe('search index probe', () => {
  it('reports the current request mode instead of a shared project cache', async () => {
    detailedSearch.mockResolvedValue({
      entries: [],
      diagnostics: { version: '1', mode: 'hybrid' },
      derivedViews: {},
    });
    expect(await probeSearchIndex('org/repo')).toBe('hybrid');
    expect(cachedMode).not.toHaveBeenCalled();
  });
});
