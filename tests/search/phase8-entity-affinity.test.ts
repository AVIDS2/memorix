/**
 * P8-A1: Entity-affinity scoring logic tests
 *
 * Mirrors the entity-affinity pass in orama-store.ts.
 * Tests the pure logic: token extraction, entity matching, boost application.
 */

import { describe, it, expect } from 'vitest';

// ── Pure logic helpers mirroring the orama-store.ts implementation ──

interface EntryStub {
  entityName?: string;
  score: number;
}

function extractAffTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.replace(/[_-]/g, ''))
    .filter(t => t.length >= 4);
}

function applyEntityAffinity(
  entries: EntryStub[],
  query: string,
  opts = { topK: 8, window: 0.20, boost: 1.08 },
): EntryStub[] {
  const affTokens = extractAffTokens(query);
  if (affTokens.length === 0) return entries;

  const entityNames = [...new Set(entries.map(e => e.entityName).filter((n): n is string => !!n))];
  const matchedEntities = new Set(
    entityNames.filter(name => {
      const norm = name.toLowerCase().replace(/[_-]/g, '');
      return affTokens.some(t => norm.includes(t));
    }),
  );

  if (matchedEntities.size === 0 || matchedEntities.size >= entityNames.length) return entries;

  const topScore = entries[0]?.score ?? 0;
  const threshold = topScore * (1 - opts.window);
  const result = entries.map((e, i) => {
    if (i >= opts.topK) return e;
    if (e.score < threshold) return e;
    if (matchedEntities.has(e.entityName ?? '')) {
      return { ...e, score: e.score * opts.boost };
    }
    return e;
  });
  return result.sort((a, b) => b.score - a.score);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('P8-A1: entity-affinity scoring logic', () => {
  it('boosts matching entity results', () => {
    const entries: EntryStub[] = [
      { entityName: 'blog-vps', score: 1.0 },
      { entityName: 'api-relay', score: 0.95 },
    ];
    const result = applyEntityAffinity(entries, 'blog VPS deployment');
    const blogEntry = result.find(e => e.entityName === 'blog-vps');
    const apiEntry = result.find(e => e.entityName === 'api-relay');
    expect(blogEntry!.score).toBeGreaterThan(apiEntry!.score);
    expect(blogEntry!.score).toBeCloseTo(1.0 * 1.08);
    expect(apiEntry!.score).toBe(0.95);
  });

  it('does NOT fire when all entities match the query', () => {
    const entries: EntryStub[] = [
      { entityName: 'blog-vps', score: 1.0 },
      { entityName: 'blog-config', score: 0.95 },
    ];
    const result = applyEntityAffinity(entries, 'blog setup');
    expect(result[0].score).toBe(1.0);
    expect(result[1].score).toBe(0.95);
  });

  it('does NOT fire when no entities match the query', () => {
    const entries: EntryStub[] = [
      { entityName: 'api-relay', score: 1.0 },
      { entityName: 'devlens', score: 0.95 },
    ];
    const result = applyEntityAffinity(entries, 'deploy infrastructure');
    expect(result[0].score).toBe(1.0);
    expect(result[1].score).toBe(0.95);
  });

  it('does NOT boost entries outside the 20% window', () => {
    const entries: EntryStub[] = [
      { entityName: 'api-relay', score: 1.0 },
      { entityName: 'blog-vps', score: 0.7 },
    ];
    const result = applyEntityAffinity(entries, 'blog VPS');
    const blogEntry = result.find(e => e.entityName === 'blog-vps');
    expect(blogEntry!.score).toBe(0.7);
  });

  it('does NOT fire for short query tokens (< 4 chars)', () => {
    const entries: EntryStub[] = [
      { entityName: 'vps', score: 1.0 },
      { entityName: 'api-relay', score: 0.95 },
    ];
    const result = applyEntityAffinity(entries, 'vps up');
    expect(result[0].score).toBe(1.0);
    expect(result[1].score).toBe(0.95);
  });

  it('boost amplitude is ×1.08 — cannot reverse a 15%+ gap', () => {
    const entries: EntryStub[] = [
      { entityName: 'api-relay', score: 1.0 },
      { entityName: 'blog-vps', score: 0.9 },
    ];
    const result = applyEntityAffinity(entries, 'blog VPS deployment');
    const blogEntry = result.find(e => e.entityName === 'blog-vps')!;
    const apiEntry = result.find(e => e.entityName === 'api-relay')!;
    expect(blogEntry.score).toBeCloseTo(0.9 * 1.08);
    expect(blogEntry.score).toBeLessThan(apiEntry.score);
  });

  it('handles entries without entityName gracefully', () => {
    const entries: EntryStub[] = [
      { entityName: 'blog-vps', score: 1.0 },
      { score: 0.95 },
    ];
    expect(() => applyEntityAffinity(entries, 'blog VPS deployment')).not.toThrow();
  });
});

describe('P8-A1: affinity token extraction', () => {
  it('extracts tokens of 4+ chars', () => {
    expect(extractAffTokens('blog VPS deployment')).toEqual(['blog', 'deployment']);
  });

  it('strips hyphens/underscores from tokens', () => {
    expect(extractAffTokens('api-relay setup')).toEqual(['apirelay', 'setup']);
  });

  it('returns empty for all-short tokens', () => {
    expect(extractAffTokens('vps up on db')).toEqual([]);
  });
});
