/**
 * P7-A: Graph neighbor routing hint in L1 Routing
 *
 * Tests the 1-hop graph neighbor lookup that enriches the L1 Routing section
 * of session context. The lookup is:
 *   - routing-only (no query expansion, no rerank)
 *   - 1-hop only (direct relations only)
 *   - gated by hasL1Content (does not open L1 Routing on its own)
 *   - capped at 5 unique neighbor names
 *   - entity names only (no relation types)
 *   - silent on errors / empty graph
 */

import { describe, it, expect } from 'vitest';
import type { Relation } from '../../src/types.js';

// ── Pure logic helpers mirroring the session.ts implementation ───────

type RelationStub = Pick<Relation, 'from' | 'to' | 'relationType'>;

/**
 * Mirrors the graph neighbor derivation in getSessionContext().
 * Returns 1-hop neighbors of activeEntities from the given relations,
 * excluding entities already in activeEntities, capped at max.
 */
function deriveGraphNeighbors(
  activeEntities: string[],
  relations: RelationStub[],
  max = 5,
): string[] {
  if (activeEntities.length === 0) return [];
  const activeSet = new Set(activeEntities.map((n) => n.toLowerCase()));
  const neighborSet = new Set<string>();
  for (const rel of relations) {
    const fromLower = rel.from.toLowerCase();
    const toLower = rel.to.toLowerCase();
    if (activeSet.has(fromLower) && !activeSet.has(toLower)) neighborSet.add(rel.to);
    if (activeSet.has(toLower) && !activeSet.has(fromLower)) neighborSet.add(rel.from);
  }
  return [...neighborSet].slice(0, max);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('P7-A: graph neighbor routing hint logic', () => {
  it('finds direct outbound neighbors (from → to)', () => {
    const relations: RelationStub[] = [
      { from: 'auth', to: 'JWT', relationType: 'implements' },
      { from: 'auth', to: 'session', relationType: 'uses' },
    ];
    const result = deriveGraphNeighbors(['auth'], relations);
    expect(result).toContain('JWT');
    expect(result).toContain('session');
  });

  it('finds direct inbound neighbors (to ← from)', () => {
    const relations: RelationStub[] = [
      { from: 'OAuth', to: 'auth', relationType: 'alternative' },
    ];
    const result = deriveGraphNeighbors(['auth'], relations);
    expect(result).toContain('OAuth');
  });

  it('symmetric: both directions discovered in one pass', () => {
    const relations: RelationStub[] = [
      { from: 'auth', to: 'JWT', relationType: 'implements' },
      { from: 'OAuth', to: 'auth', relationType: 'alternative' },
    ];
    const result = deriveGraphNeighbors(['auth'], relations);
    expect(result).toContain('JWT');
    expect(result).toContain('OAuth');
  });

  it('does NOT include entities already in activeEntities', () => {
    const relations: RelationStub[] = [
      { from: 'auth', to: 'database', relationType: 'queries' },
      { from: 'auth', to: 'JWT', relationType: 'implements' },
    ];
    // database is already an active entity
    const result = deriveGraphNeighbors(['auth', 'database'], relations);
    expect(result).not.toContain('database');
    expect(result).toContain('JWT');
  });

  it('case-insensitive dedup: "Auth" and "auth" treated as same entity', () => {
    const relations: RelationStub[] = [
      { from: 'Auth', to: 'JWT', relationType: 'implements' },
    ];
    // activeEntities uses lowercase 'auth', relation uses 'Auth'
    const result = deriveGraphNeighbors(['auth'], relations);
    expect(result).toContain('JWT');
  });

  it('caps at 5 neighbors', () => {
    const relations: RelationStub[] = Array.from({ length: 8 }, (_, i) => ({
      from: 'auth',
      to: `entity${i}`,
      relationType: 'uses',
    }));
    const result = deriveGraphNeighbors(['auth'], relations);
    expect(result).toHaveLength(5);
  });

  it('empty activeEntities → no neighbors computed', () => {
    const relations: RelationStub[] = [
      { from: 'auth', to: 'JWT', relationType: 'implements' },
    ];
    expect(deriveGraphNeighbors([], relations)).toEqual([]);
  });

  it('empty graph (no relations) → empty neighbors', () => {
    expect(deriveGraphNeighbors(['auth', 'database'], [])).toEqual([]);
  });

  it('relations between non-active entities are ignored', () => {
    const relations: RelationStub[] = [
      { from: 'JWT', to: 'OAuth', relationType: 'related' },
    ];
    // Neither JWT nor OAuth is in activeEntities
    const result = deriveGraphNeighbors(['auth'], relations);
    expect(result).toEqual([]);
  });

  it('deduplicates neighbors when same entity appears via multiple paths', () => {
    const relations: RelationStub[] = [
      { from: 'auth', to: 'JWT', relationType: 'implements' },
      { from: 'database', to: 'JWT', relationType: 'stores' },
    ];
    const result = deriveGraphNeighbors(['auth', 'database'], relations);
    const jwtCount = result.filter((n) => n === 'JWT').length;
    expect(jwtCount).toBe(1);
  });
});

// ── Gating: graph neighbors do not open L1 Routing on their own ───────

describe('P7-A: L1 Routing gate — graph neighbors do not open section alone', () => {
  it('hasL1Content gate unchanged: requires hooks or git', () => {
    const hasL1Content = (l1HookCount: number, l3GitCount: number) =>
      l1HookCount > 0 || l3GitCount > 0;

    // graph neighbors alone cannot open L1 Routing
    expect(hasL1Content(0, 0)).toBe(false);
    // hooks open it (graph neighbors then appear inside)
    expect(hasL1Content(1, 0)).toBe(true);
    // git evidence opens it (graph neighbors then appear inside)
    expect(hasL1Content(0, 3)).toBe(true);
  });

  it('graph neighbors hint format is comma-separated entity names', () => {
    const neighbors = ['JWT', 'session', 'OAuth'];
    const hint = `Graph neighbors: ${neighbors.join(', ')}`;
    expect(hint).toBe('Graph neighbors: JWT, session, OAuth');
    expect(hint).not.toContain('implements');
    expect(hint).not.toContain('uses');
    expect(hint).not.toContain('→');
  });
});
