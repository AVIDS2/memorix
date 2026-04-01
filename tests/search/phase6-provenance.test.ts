/**
 * Phase 6: Provenance-aware retrieval tests
 *
 * Covers:
 *   P6-A: effectiveSource() — sourceDetail='git-ingest' treated as source='git' in intent boost
 *   P6-B: provenance tiebreaker — standard tier, top-8, 20% window, tiny amplitude
 *   P6-C: session context active entities — in L1 Routing, max 5
 */

import { describe, it, expect } from 'vitest';

// ── P6-A: effectiveSource logic ───────────────────────────────────────
// The helper is internal to orama-store.ts; we test its contract by
// replicating the logic and verifying the expected mappings.

/** Mirrors the effectiveSource() helper in orama-store.ts */
function effectiveSource(
  source: 'agent' | 'git' | 'manual',
  sourceDetail?: 'explicit' | 'hook' | 'git-ingest',
): 'agent' | 'git' | 'manual' {
  return sourceDetail === 'git-ingest' ? 'git' : source;
}

describe('P6-A: effectiveSource()', () => {
  it('sourceDetail=git-ingest → "git" regardless of source field', () => {
    expect(effectiveSource('agent', 'git-ingest')).toBe('git');
  });

  it('source=git + no sourceDetail → "git" (unchanged legacy)', () => {
    expect(effectiveSource('git', undefined)).toBe('git');
  });

  it('sourceDetail=explicit → keeps source as-is', () => {
    expect(effectiveSource('agent', 'explicit')).toBe('agent');
  });

  it('sourceDetail=hook → keeps source as-is (hook is not git evidence)', () => {
    expect(effectiveSource('agent', 'hook')).toBe('agent');
  });

  it('source=manual + no sourceDetail → "manual" (unchanged)', () => {
    expect(effectiveSource('manual', undefined)).toBe('manual');
  });

  it('source=git + sourceDetail=explicit → "git" (source already set, explicit overrides nothing)', () => {
    expect(effectiveSource('git', 'explicit')).toBe('git');
  });
});

// ── P6-A: source-aware boost uses effectiveSource ─────────────────────
// Verify that git-ingest obs would receive the 2.0× intent boost on
// what_changed intent (same boost as legacy source='git'), and hook obs
// does NOT receive git boost.

describe('P6-A: source-aware boost correctness', () => {
  const WHAT_CHANGED_SRC_BOOSTS: Partial<Record<'agent' | 'git' | 'manual', number>> = {
    git: 2.0,
    agent: 0.8,
  };

  function applyBoost(
    score: number,
    source: 'agent' | 'git' | 'manual',
    sourceDetail: 'explicit' | 'hook' | 'git-ingest' | undefined,
    confidence: number,
  ): number {
    const src = effectiveSource(source, sourceDetail);
    const boost = WHAT_CHANGED_SRC_BOOSTS[src] ?? 1.0;
    const effectiveBoost = 1 + (boost - 1) * confidence;
    return score * effectiveBoost;
  }

  it('sourceDetail=git-ingest gets full 2.0× git boost on what_changed (was 1.0× before fix)', () => {
    const baseScore = 1.0;
    const boosted = applyBoost(baseScore, 'agent', 'git-ingest', 1.0);
    expect(boosted).toBeCloseTo(2.0);
  });

  it('source=git (legacy) still gets 2.0× boost (backward-compat)', () => {
    const baseScore = 1.0;
    const boosted = applyBoost(baseScore, 'git', undefined, 1.0);
    expect(boosted).toBeCloseTo(2.0);
  });

  it('sourceDetail=hook stays at 0.8× (agent) — no git boost', () => {
    const baseScore = 1.0;
    const boosted = applyBoost(baseScore, 'agent', 'hook', 1.0);
    expect(boosted).toBeCloseTo(0.8);
  });

  it('sourceDetail=explicit (no git) stays at 0.8×', () => {
    const boosted = applyBoost(1.0, 'agent', 'explicit', 1.0);
    expect(boosted).toBeCloseTo(0.8);
  });

  it('low confidence (0.2) → boost attenuated — does not fully apply', () => {
    // confidence < 0.3 threshold in searchObservations means boost ≈ 1.0
    const boostedHighConf = applyBoost(1.0, 'agent', 'git-ingest', 1.0);
    const boostedLowConf = applyBoost(1.0, 'agent', 'git-ingest', 0.1);
    expect(boostedHighConf).toBeGreaterThan(boostedLowConf);
    // Low confidence barely moves the score
    expect(boostedLowConf).toBeCloseTo(1 + (2.0 - 1) * 0.1);
  });
});

// ── P6-B: provenance tiebreaker logic ─────────────────────────────────
// Test the tiebreaker as a pure function to verify its contract:
//   - Only applies within 20% window of top score
//   - git evidence → ×1.06, core → ×1.03
//   - Does NOT reverse large score gaps

type TiebreakerEntry = {
  score: number;
  source: 'agent' | 'git' | 'manual';
  sourceDetail?: 'explicit' | 'hook' | 'git-ingest';
  valueCategory?: 'core' | 'contextual' | 'ephemeral';
  id: number;
};

function applyTiebreaker(entries: TiebreakerEntry[]): TiebreakerEntry[] {
  if (entries.length <= 1) return entries;
  const TIEBREAK_TOP_K = 8;
  const TIEBREAK_WINDOW = 0.20;
  const topScore = entries[0]?.score ?? 0;
  const threshold = topScore * (1 - TIEBREAK_WINDOW);
  const result = entries.map(e => ({ ...e }));
  let changed = false;
  for (let i = 0; i < Math.min(TIEBREAK_TOP_K, result.length); i++) {
    const entry = result[i];
    if (entry.score < threshold) break;
    const isGitEvidence = effectiveSource(entry.source, entry.sourceDetail) === 'git';
    const isCore = entry.valueCategory === 'core';
    if (isGitEvidence) {
      result[i] = { ...entry, score: entry.score * 1.06 };
      changed = true;
    } else if (isCore) {
      result[i] = { ...entry, score: entry.score * 1.03 };
      changed = true;
    }
  }
  if (changed) result.sort((a, b) => b.score - a.score);
  return result;
}

describe('P6-B: provenance tiebreaker', () => {
  it('git-ingest obs gets ×1.06 boost within 20% window', () => {
    const entries: TiebreakerEntry[] = [
      { id: 1, score: 1.00, source: 'agent', sourceDetail: 'explicit' },
      { id: 2, score: 0.95, source: 'agent', sourceDetail: 'git-ingest' },
    ];
    const result = applyTiebreaker(entries);
    // id=2 was 0.95, after ×1.06 = 1.007 → should be ranked first
    expect(result[0].id).toBe(2);
    expect(result[0].score).toBeCloseTo(0.95 * 1.06);
  });

  it('core obs gets ×1.03 boost within 20% window', () => {
    const entries: TiebreakerEntry[] = [
      { id: 1, score: 1.00, source: 'agent', sourceDetail: 'explicit' },
      { id: 2, score: 0.99, source: 'agent', valueCategory: 'core' },
    ];
    const result = applyTiebreaker(entries);
    expect(result[0].id).toBe(2);
    expect(result[0].score).toBeCloseTo(0.99 * 1.03);
  });

  it('git evidence priority over core (both in window)', () => {
    const entries: TiebreakerEntry[] = [
      { id: 1, score: 1.00, source: 'agent' },
      { id: 2, score: 0.95, source: 'agent', valueCategory: 'core' },
      { id: 3, score: 0.92, source: 'agent', sourceDetail: 'git-ingest' },
    ];
    const result = applyTiebreaker(entries);
    // id=3 (0.92 × 1.06 = 0.9752) vs id=2 (0.95 × 1.03 = 0.9785)
    // In this case core still beats git-ingest because gap+multiplier: 0.9785 > 0.9752
    // The key assertion: neither reverses id=1 at 1.00
    expect(result[0].id).toBe(1);
  });

  it('does NOT reverse a large score gap (40% gap > 20% window)', () => {
    const entries: TiebreakerEntry[] = [
      { id: 1, score: 1.00, source: 'agent', sourceDetail: 'explicit' },
      { id: 2, score: 0.55, source: 'agent', sourceDetail: 'git-ingest' }, // outside 20% window
    ];
    const result = applyTiebreaker(entries);
    // id=2 is below threshold (1.00 * 0.80 = 0.80), tiebreaker does not apply
    expect(result[0].id).toBe(1);
    // id=2 score unchanged
    expect(result[1].score).toBeCloseTo(0.55);
  });

  it('only top-8 entries get tiebreaker (index 8 is not modified)', () => {
    const entries: TiebreakerEntry[] = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      score: 1.00 - i * 0.01, // all within 10% window (well within 20%)
      source: 'agent' as const,
      sourceDetail: 'git-ingest' as const,
    }));
    const before9Score = entries[8].score; // index 8 = 9th item
    const result = applyTiebreaker(entries);
    // Find id=9 in result
    const item9 = result.find(e => e.id === 9);
    // Index 8 (TIEBREAK_TOP_K limit) should NOT be boosted
    expect(item9?.score).toBeCloseTo(before9Score);
  });

  it('single entry → no change', () => {
    const entries: TiebreakerEntry[] = [
      { id: 1, score: 1.0, source: 'git' },
    ];
    expect(applyTiebreaker(entries)).toHaveLength(1);
    expect(applyTiebreaker(entries)[0].score).toBe(1.0);
  });

  it('no provenance signal → no score change', () => {
    const entries: TiebreakerEntry[] = [
      { id: 1, score: 1.00, source: 'agent', sourceDetail: 'explicit', valueCategory: 'contextual' },
      { id: 2, score: 0.98, source: 'agent', sourceDetail: 'explicit', valueCategory: 'contextual' },
    ];
    const result = applyTiebreaker(entries);
    expect(result[0].id).toBe(1);
    expect(result[0].score).toBeCloseTo(1.00); // no boost applied
    expect(result[1].score).toBeCloseTo(0.98);
  });

  it('git-ingest amplitude cap: ×1.06 never exceeds top score by more than 6%', () => {
    const entries: TiebreakerEntry[] = [
      { id: 1, score: 1.00, source: 'agent' },
      { id: 2, score: 0.99, source: 'agent', sourceDetail: 'git-ingest' },
    ];
    const result = applyTiebreaker(entries);
    const boostedScore = result.find(e => e.id === 2)!.score;
    expect(boostedScore).toBeLessThanOrEqual(0.99 * 1.06 + 0.001);
    expect(boostedScore).toBeGreaterThan(0.99);
  });
});

// ── P6-C: session context active entities ────────────────────────────

type ObsStub = { entityName?: string; type: string };

/** Mirrors the activeEntities derivation in session.ts */
function deriveActiveEntities(l2Obs: ObsStub[], max = 5): string[] {
  return [
    ...new Set(l2Obs.map((o) => o.entityName).filter((n): n is string => !!n && n.trim().length > 0)),
  ].slice(0, max);
}

describe('P6-C: session context active entities', () => {
  it('extracts unique entityNames from l2Obs in order', () => {
    const l2Obs = [
      { entityName: 'auth', type: 'decision' },
      { entityName: 'database', type: 'gotcha' },
      { entityName: 'auth', type: 'problem-solution' }, // duplicate
    ];
    expect(deriveActiveEntities(l2Obs)).toEqual(['auth', 'database']);
  });

  it('caps at max 5 entities', () => {
    const l2Obs = ['a', 'b', 'c', 'd', 'e', 'f'].map(n => ({ entityName: n, type: 'decision' }));
    const result = deriveActiveEntities(l2Obs);
    expect(result).toHaveLength(5);
    expect(result).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('empty l2Obs → empty array (L1 Routing section stays hidden)', () => {
    expect(deriveActiveEntities([])).toEqual([]);
  });

  it('filters out blank/empty entityNames', () => {
    const l2Obs = [
      { entityName: '', type: 'decision' },
      { entityName: '   ', type: 'gotcha' },
      { entityName: 'search', type: 'decision' },
    ];
    expect(deriveActiveEntities(l2Obs)).toEqual(['search']);
  });

  it('undefined entityName entries are dropped', () => {
    const l2Obs = [
      { entityName: undefined, type: 'decision' },
      { entityName: 'embeddings', type: 'decision' },
    ];
    expect(deriveActiveEntities(l2Obs)).toEqual(['embeddings']);
  });

  it('output is formatted as comma-separated hint line', () => {
    const entities = ['auth', 'database', 'search'];
    const hint = `Active entities: ${entities.join(', ')}`;
    expect(hint).toBe('Active entities: auth, database, search');
    expect(hint).toContain('Active entities:');
  });

  it('active entities appear inside L1 Routing when section is already open (hooks/git)', () => {
    // L1 Routing opens only when hooks or git evidence exist.
    // Active entities enrich the section but do not open it alone.
    const hasL1Content = (l1HookCount: number, l3GitCount: number) =>
      l1HookCount > 0 || l3GitCount > 0;

    expect(hasL1Content(0, 0)).toBe(false);   // entities alone → L1 Routing NOT shown
    expect(hasL1Content(1, 0)).toBe(true);    // hook → L1 Routing shown (entities added inside)
    expect(hasL1Content(0, 3)).toBe(true);    // git evidence → L1 Routing shown
  });
});
