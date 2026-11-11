/**
 * P8-A2: Session per-entity cap tests
 *
 * Mirrors the per-entity cap logic in getSessionContext() (session.ts).
 * The cap (max 3/entity) only activates when multiple distinct entities are present.
 */

import { describe, it, expect } from 'vitest';

// ── Pure logic helper mirroring session.ts per-entity cap ─────────────

interface ScoredObs {
  entityName?: string;
  score: number;
  id: number;
}

function applyEntityCap(
  scored: ScoredObs[],
  cap = 3,
  limit = 5,
): ScoredObs[] {
  const distinctEntities = new Set(scored.map(o => o.entityName).filter(Boolean)).size;

  if (distinctEntities <= 1) {
    return scored.slice(0, limit);
  }

  const entityCount = new Map<string, number>();
  return scored
    .filter(o => {
      const key = o.entityName ?? '';
      const count = entityCount.get(key) ?? 0;
      if (count >= cap) return false;
      entityCount.set(key, count + 1);
      return true;
    })
    .slice(0, limit);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('P8-A2: per-entity cap logic', () => {
  it('single entity: no cap applied, all results pass through', () => {
    const scored: ScoredObs[] = [
      { entityName: 'blog-vps', score: 5, id: 1 },
      { entityName: 'blog-vps', score: 4, id: 2 },
      { entityName: 'blog-vps', score: 3, id: 3 },
      { entityName: 'blog-vps', score: 2, id: 4 },
      { entityName: 'blog-vps', score: 1, id: 5 },
    ];
    const result = applyEntityCap(scored);
    expect(result).toHaveLength(5);
    expect(result.every(o => o.entityName === 'blog-vps')).toBe(true);
  });

  it('multiple entities: cap at 3 per entity', () => {
    const scored: ScoredObs[] = [
      { entityName: 'api-relay', score: 9, id: 1 },
      { entityName: 'api-relay', score: 8, id: 2 },
      { entityName: 'api-relay', score: 7, id: 3 },
      { entityName: 'api-relay', score: 6, id: 4 },
      { entityName: 'blog-vps', score: 5, id: 5 },
      { entityName: 'blog-vps', score: 4, id: 6 },
    ];
    const result = applyEntityCap(scored);
    const apiCount = result.filter(o => o.entityName === 'api-relay').length;
    expect(apiCount).toBeLessThanOrEqual(3);
    expect(result.some(o => o.entityName === 'blog-vps')).toBe(true);
  });

  it('multiple entities: cap prevents one workstream monopolizing all 5 slots', () => {
    const scored: ScoredObs[] = Array.from({ length: 5 }, (_, i) => ({
      entityName: 'api-relay',
      score: 10 - i,
      id: i + 1,
    })).concat({ entityName: 'blog-vps', score: 1, id: 99 });

    const result = applyEntityCap(scored, 3, 5);
    const apiCount = result.filter(o => o.entityName === 'api-relay').length;
    expect(apiCount).toBe(3);
    expect(result.some(o => o.entityName === 'blog-vps')).toBe(true);
  });

  it('respects the overall limit after capping', () => {
    const scored: ScoredObs[] = [
      { entityName: 'a', score: 10, id: 1 },
      { entityName: 'b', score: 9, id: 2 },
      { entityName: 'a', score: 8, id: 3 },
      { entityName: 'b', score: 7, id: 4 },
      { entityName: 'a', score: 6, id: 5 },
      { entityName: 'c', score: 5, id: 6 },
    ];
    const result = applyEntityCap(scored, 3, 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('handles entries without entityName', () => {
    const scored: ScoredObs[] = [
      { entityName: 'api-relay', score: 9, id: 1 },
      { score: 8, id: 2 },
      { entityName: 'blog-vps', score: 7, id: 3 },
    ];
    expect(() => applyEntityCap(scored)).not.toThrow();
  });

  it('single distinct entity even with undefined names: no cap applied', () => {
    const scored: ScoredObs[] = [
      { score: 9, id: 1 },
      { score: 8, id: 2 },
      { score: 7, id: 3 },
      { score: 6, id: 4 },
      { score: 5, id: 5 },
    ];
    const result = applyEntityCap(scored);
    expect(result).toHaveLength(5);
  });
});
