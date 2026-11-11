import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSurfacedRegistry,
  getSurfacedIds,
  recordSurfacedIds,
} from '../../src/search/surfaced-registry.js';

describe('surfaced registry', () => {
  beforeEach(() => {
    clearSurfacedRegistry();
  });

  it('records and returns ids in insertion order without duplicates', () => {
    recordSurfacedIds('session:a', [1, 2]);
    recordSurfacedIds('session:a', [2, 3]);
    expect(getSurfacedIds('session:a')).toEqual([1, 2, 3]);
  });

  it('keeps scopes independent', () => {
    recordSurfacedIds('session:a', [1]);
    recordSurfacedIds('project:p', [9]);
    expect(getSurfacedIds('session:a')).toEqual([1]);
    expect(getSurfacedIds('project:p')).toEqual([9]);
  });

  it('caps the per-scope id count, dropping the oldest', () => {
    const ids = Array.from({ length: 250 }, (_, index) => index + 1);
    recordSurfacedIds('session:a', ids);
    const kept = getSurfacedIds('session:a');
    expect(kept).toHaveLength(200);
    expect(kept[0]).toBe(51);
    expect(kept[199]).toBe(250);
  });

  it('caps the scope count, evicting the least recently used scope', () => {
    for (let index = 0; index < 70; index += 1) {
      recordSurfacedIds(`scope:${index}`, [index]);
      getSurfacedIds(`scope:${index}`); // touch so eviction order is LRU-ish
    }
    expect(getSurfacedIds('scope:0')).toEqual([]);
    expect(getSurfacedIds('scope:69')).toEqual([69]);
  });

  it('touching a scope moves it to the back of the eviction queue', () => {
    recordSurfacedIds('scope:a', [1]);
    recordSurfacedIds('scope:b', [2]);
    getSurfacedIds('scope:a'); // touch a, so b is now the oldest
    for (let index = 0; index < 63; index += 1) {
      recordSurfacedIds(`scope:filler-${index}`, [index]);
    }
    expect(getSurfacedIds('scope:a')).toEqual([1]); // survived
    expect(getSurfacedIds('scope:b')).toEqual([]); // evicted
  });
});
