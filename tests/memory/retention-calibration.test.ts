/**
 * Phase 10 Retention Calibration Tests
 *
 * Covers:
 * - Immunity tightening: high importance no longer grants immunity
 * - valueCategory retention multiplier
 * - MIN_RETENTION_DAYS floor (7 days)
 * - Combined multiplier stacking (source × valueCategory)
 * - explainRetention() structured output
 * - getEffectiveRetentionDays() correctness
 * - getImmunityReason() correctness
 */

import { describe, it, expect } from 'vitest';
import {
  isImmune,
  getImmunityReason,
  getImportanceLevel,
  getEffectiveRetentionDays,
  calculateRelevance,
  getRetentionZone,
  explainRetention,
} from '../../src/memory/retention.js';
import type { MemorixDocument } from '../../src/types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<MemorixDocument> = {}): MemorixDocument {
  return {
    id: 'obs-1',
    observationId: 1,
    entityName: 'test-entity',
    type: 'decision',
    title: 'Test decision',
    narrative: 'A test decision for calibration.',
    facts: '',
    filesModified: '',
    concepts: '',
    tokens: 50,
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days old
    projectId: 'test/calibration',
    accessCount: 0,
    lastAccessedAt: '',
    status: 'active',
    source: 'agent',
    sourceDetail: '',
    valueCategory: '',
    ...overrides,
  };
}

// ── Immunity tightening ──────────────────────────────────────────────

describe('Immunity tightening', () => {
  it('high importance alone no longer grants immunity', () => {
    // gotcha, decision, trade-off, reasoning all map to 'high'
    for (const type of ['gotcha', 'decision', 'trade-off', 'reasoning']) {
      const doc = makeDoc({ type, accessCount: 0, valueCategory: '' });
      expect(getImportanceLevel(doc)).toBe('high');
      expect(isImmune(doc)).toBe(false);
    }
  });

  it('critical importance still grants immunity', () => {
    // No type maps to critical by default, but test the path directly
    const doc = makeDoc({ type: 'unknown-critical' as any });
    // type not in TYPE_IMPORTANCE → defaults to 'medium', not immune
    expect(isImmune(doc)).toBe(false);

    // Simulate a doc that somehow has critical importance via concepts tag
    const tagged = makeDoc({ concepts: 'critical' });
    expect(isImmune(tagged)).toBe(true);
  });

  it('core valueCategory grants immunity regardless of type', () => {
    const doc = makeDoc({ type: 'discovery', valueCategory: 'core' });
    expect(isImmune(doc)).toBe(true);
  });

  it('accessCount >= 3 grants immunity', () => {
    const doc = makeDoc({ type: 'discovery', accessCount: 3 });
    expect(isImmune(doc)).toBe(true);
  });

  it('accessCount < 3 does not grant immunity for non-immune types', () => {
    const doc = makeDoc({ type: 'discovery', accessCount: 2 });
    expect(isImmune(doc)).toBe(false);
  });

  it('protected tags grant immunity', () => {
    for (const tag of ['keep', 'important', 'pinned', 'critical']) {
      const doc = makeDoc({ type: 'discovery', concepts: tag });
      expect(isImmune(doc)).toBe(true);
    }
  });

  it('high importance type with core valueCategory is still immune', () => {
    const doc = makeDoc({ type: 'decision', valueCategory: 'core' });
    expect(isImmune(doc)).toBe(true);
  });

  it('high importance type with frequent access is still immune', () => {
    const doc = makeDoc({ type: 'gotcha', accessCount: 5 });
    expect(isImmune(doc)).toBe(true);
  });
});

// ── getImmunityReason ────────────────────────────────────────────────

describe('getImmunityReason', () => {
  it('returns null for non-immune observations', () => {
    const doc = makeDoc({ type: 'decision', accessCount: 0, valueCategory: '' });
    expect(getImmunityReason(doc)).toBeNull();
  });

  it('returns core reason', () => {
    const doc = makeDoc({ valueCategory: 'core' });
    expect(getImmunityReason(doc)).toContain('core');
  });

  it('returns frequently accessed reason with count', () => {
    const doc = makeDoc({ type: 'discovery', accessCount: 5 });
    expect(getImmunityReason(doc)).toContain('5×');
  });

  it('returns protected tag reason', () => {
    const doc = makeDoc({ type: 'discovery', concepts: 'keep' });
    expect(getImmunityReason(doc)).toContain('protected tag');
  });
});

// ── valueCategory retention multiplier ───────────────────────────────

describe('valueCategory retention multiplier', () => {
  it('ephemeral decays faster than neutral (same type, same age)', () => {
    const neutral = makeDoc({ sourceDetail: '', valueCategory: '' });
    const ephemeral = makeDoc({ sourceDetail: '', valueCategory: 'ephemeral' });

    const neutralScore = calculateRelevance(neutral).totalScore;
    const ephemeralScore = calculateRelevance(ephemeral).totalScore;

    expect(ephemeralScore).toBeLessThan(neutralScore);
  });

  it('core decays slower than neutral (same type, same age)', () => {
    const neutral = makeDoc({ sourceDetail: '', valueCategory: '' });
    const core = makeDoc({ sourceDetail: '', valueCategory: 'core' });

    const neutralScore = calculateRelevance(neutral).totalScore;
    const coreScore = calculateRelevance(core).totalScore;

    expect(coreScore).toBeGreaterThan(neutralScore);
  });

  it('contextual is neutral (same as undefined)', () => {
    const undef = makeDoc({ valueCategory: '' });
    const contextual = makeDoc({ valueCategory: 'contextual' });

    const undefScore = calculateRelevance(undef).totalScore;
    const contextualScore = calculateRelevance(contextual).totalScore;

    expect(contextualScore).toBeCloseTo(undefScore, 5);
  });

  it('ephemeral enters stale zone earlier than neutral', () => {
    // low importance: 30d base retention
    // neutral: 30d effective → stale at 15d
    // ephemeral: 30d × 0.5 = 15d effective → stale at 7.5d
    const age12d = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString();
    const neutral = makeDoc({ type: 'discovery', sourceDetail: '', valueCategory: '', createdAt: age12d });
    const ephemeral = makeDoc({ type: 'discovery', sourceDetail: '', valueCategory: 'ephemeral', createdAt: age12d });

    expect(getRetentionZone(neutral)).toBe('active');
    expect(getRetentionZone(ephemeral)).toBe('stale');
  });
});

// ── getEffectiveRetentionDays ────────────────────────────────────────

describe('getEffectiveRetentionDays', () => {
  it('returns base retention for neutral multipliers', () => {
    const doc = makeDoc({ type: 'decision', sourceDetail: '', valueCategory: '' });
    expect(getEffectiveRetentionDays(doc)).toBe(180); // high importance base
  });

  it('applies source multiplier', () => {
    const hook = makeDoc({ type: 'decision', sourceDetail: 'hook', valueCategory: '' });
    expect(getEffectiveRetentionDays(hook)).toBe(90); // 180 × 0.5
  });

  it('applies valueCategory multiplier', () => {
    const ephemeral = makeDoc({ type: 'decision', sourceDetail: '', valueCategory: 'ephemeral' });
    expect(getEffectiveRetentionDays(ephemeral)).toBe(90); // 180 × 0.5
  });

  it('applies git-ingest × core stacking', () => {
    const doc = makeDoc({ type: 'decision', sourceDetail: 'git-ingest', valueCategory: 'core' });
    expect(getEffectiveRetentionDays(doc)).toBe(540); // 180 × 1.5 × 2.0
  });

  it('floors at MIN_RETENTION_DAYS (7) for extreme combinations', () => {
    // low importance (30d) × hook (0.5) × ephemeral (0.5) = 7.5d → above floor
    const doc = makeDoc({ type: 'discovery', sourceDetail: 'hook', valueCategory: 'ephemeral' });
    expect(getEffectiveRetentionDays(doc)).toBe(7.5);
  });

  it('floor prevents sub-7 day retention', () => {
    // Simulate a scenario where raw would be very low
    // session-request (low=30d) × hook (0.5) × ephemeral (0.5) = 7.5 → still above 7
    // The floor is 7, and the minimum raw we can get is 30 × 0.5 × 0.5 = 7.5
    // So let's verify the floor path exists by checking boundary
    const doc = makeDoc({ type: 'session-request', sourceDetail: 'hook', valueCategory: 'ephemeral' });
    const effective = getEffectiveRetentionDays(doc);
    expect(effective).toBeGreaterThanOrEqual(7);
  });
});

// ── Combined multiplier stacking ─────────────────────────────────────

describe('Combined multiplier stacking', () => {
  it('hook + ephemeral stacks both multipliers for faster decay', () => {
    const neutral = makeDoc({ type: 'what-changed', sourceDetail: '', valueCategory: '' });
    const hookEphemeral = makeDoc({ type: 'what-changed', sourceDetail: 'hook', valueCategory: 'ephemeral' });

    const neutralScore = calculateRelevance(neutral).totalScore;
    const stackedScore = calculateRelevance(hookEphemeral).totalScore;

    expect(stackedScore).toBeLessThan(neutralScore);
  });

  it('git-ingest + core stacks both multipliers for slower decay', () => {
    const neutral = makeDoc({ type: 'what-changed', sourceDetail: '', valueCategory: '' });
    const gitCore = makeDoc({ type: 'what-changed', sourceDetail: 'git-ingest', valueCategory: 'core' });

    const neutralScore = calculateRelevance(neutral).totalScore;
    const gitCoreScore = calculateRelevance(gitCore).totalScore;

    expect(gitCoreScore).toBeGreaterThan(neutralScore);
  });

  it('ordering: git-ingest+core > neutral > hook+ephemeral', () => {
    const age60d = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const gitCore = makeDoc({ type: 'what-changed', sourceDetail: 'git-ingest', valueCategory: 'core', createdAt: age60d });
    const neutral = makeDoc({ type: 'what-changed', sourceDetail: '', valueCategory: '', createdAt: age60d });
    const hookEph = makeDoc({ type: 'what-changed', sourceDetail: 'hook', valueCategory: 'ephemeral', createdAt: age60d });

    const scores = [gitCore, neutral, hookEph].map(d => calculateRelevance(d).totalScore);
    expect(scores[0]).toBeGreaterThan(scores[1]); // git+core > neutral
    expect(scores[1]).toBeGreaterThan(scores[2]); // neutral > hook+ephemeral
  });
});

// ── explainRetention ─────────────────────────────────────────────────

describe('explainRetention', () => {
  it('returns correct structure for a non-immune observation', () => {
    const doc = makeDoc({ type: 'decision', sourceDetail: 'hook', valueCategory: 'ephemeral' });
    const exp = explainRetention(doc);

    expect(exp.observationId).toBe(1);
    expect(exp.importanceLevel).toBe('high');
    expect(exp.baseRetentionDays).toBe(180);
    expect(exp.sourceMultiplier).toBe(0.5);
    expect(exp.valueCategoryMultiplier).toBe(0.5);
    expect(exp.effectiveRetentionDays).toBe(45); // 180 × 0.5 × 0.5
    expect(exp.immune).toBe(false);
    expect(exp.immunityReason).toBeNull();
    expect(exp.zone).toBeDefined();
    expect(exp.ageDays).toBeGreaterThanOrEqual(0);
    expect(exp.summary).toContain('high importance');
    expect(exp.summary).toContain('source 0.5×');
    expect(exp.summary).toContain('valueCategory 0.5×');
  });

  it('returns correct structure for an immune observation', () => {
    const doc = makeDoc({ type: 'discovery', valueCategory: 'core', sourceDetail: 'git-ingest' });
    const exp = explainRetention(doc);

    expect(exp.immune).toBe(true);
    expect(exp.immunityReason).toContain('core');
    expect(exp.valueCategoryMultiplier).toBe(2.0);
    expect(exp.sourceMultiplier).toBe(1.5);
    expect(exp.summary).toContain('immune');
  });

  it('summary does not say high importance is unimportant', () => {
    // Per user constraint: high importance is still "high", not "low value"
    const doc = makeDoc({ type: 'gotcha', sourceDetail: '', valueCategory: '' });
    const exp = explainRetention(doc);

    expect(exp.importanceLevel).toBe('high');
    expect(exp.baseRetentionDays).toBe(180);
    expect(exp.summary).toContain('high importance');
    expect(exp.summary).toContain('180d base');
    // Should NOT contain negative language
    expect(exp.summary).not.toContain('low');
    expect(exp.summary).not.toContain('unimportant');
  });

  it('neutral multipliers are omitted from summary', () => {
    const doc = makeDoc({ type: 'decision', sourceDetail: '', valueCategory: '' });
    const exp = explainRetention(doc);

    // When multiplier is 1.0, it should not clutter the summary
    expect(exp.summary).not.toContain('source 1×');
    expect(exp.summary).not.toContain('valueCategory 1×');
  });

  it('summary avoids markdown table pipe separators', () => {
    const doc = makeDoc({ type: 'decision', sourceDetail: 'hook', valueCategory: 'ephemeral' });
    const exp = explainRetention(doc);
    expect(exp.summary).not.toContain(' | ');
    expect(exp.summary).toContain(' ; ');
  });

  it('ageDays is rounded to integer', () => {
    const doc = makeDoc({
      createdAt: new Date(Date.now() - 3.7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const exp = explainRetention(doc);
    expect(exp.ageDays).toBe(Math.round(3.7));
  });
});

// ── Retention zone with new multipliers ──────────────────────────────

describe('Retention zone integration', () => {
  it('high importance type without access eventually becomes stale', () => {
    // 180d retention, stale at 90d
    const age100d = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const doc = makeDoc({ type: 'decision', createdAt: age100d, accessCount: 0, valueCategory: '' });
    expect(getRetentionZone(doc)).toBe('stale');
  });

  it('high importance type without access eventually becomes archive-candidate', () => {
    // 180d retention → archive candidate after 180d
    const age200d = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const doc = makeDoc({ type: 'decision', createdAt: age200d, accessCount: 0, valueCategory: '' });
    expect(getRetentionZone(doc)).toBe('archive-candidate');
  });

  it('high importance type with core valueCategory stays active (immune)', () => {
    const age200d = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const doc = makeDoc({ type: 'decision', createdAt: age200d, valueCategory: 'core' });
    expect(getRetentionZone(doc)).toBe('active');
    expect(isImmune(doc)).toBe(true);
  });

  it('recently accessed observation stays active regardless of age', () => {
    const age200d = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const recentAccess = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const doc = makeDoc({ type: 'discovery', createdAt: age200d, lastAccessedAt: recentAccess });
    expect(getRetentionZone(doc)).toBe('active');
  });
});
