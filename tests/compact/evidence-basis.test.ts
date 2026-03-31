/**
 * Phase 4: Evidence Basis tests
 *
 * Covers:
 *   1. resolveEvidenceBasis() — derivation rules
 *   2. evidenceBasisLine()   — display output
 *   3. formatObservationDetail() — verification line in provenance header
 *   4. formatTimeline()      — anchor annotation with repository suffix
 */

import { describe, it, expect } from 'vitest';
import { resolveEvidenceBasis, evidenceBasisLine } from '../../src/memory/disclosure-policy.js';
import { formatObservationDetail, formatTimeline } from '../../src/compact/index-format.js';
import type { IndexEntry, TimelineContext } from '../../src/types.js';

// ── 1. resolveEvidenceBasis ──────────────────────────────────────────

describe('resolveEvidenceBasis', () => {
  it('commitHash → repository', () => {
    expect(resolveEvidenceBasis({ commitHash: 'abc1234' })).toBe('repository');
  });

  it('source=git → repository', () => {
    expect(resolveEvidenceBasis({ source: 'git' })).toBe('repository');
  });

  it('sourceDetail=git-ingest → repository', () => {
    expect(resolveEvidenceBasis({ sourceDetail: 'git-ingest' })).toBe('repository');
  });

  it('relatedCommits non-empty → repository', () => {
    expect(resolveEvidenceBasis({ relatedCommits: ['abc1234'] })).toBe('repository');
  });

  it('relatedCommits empty array → not repository', () => {
    expect(resolveEvidenceBasis({ sourceDetail: 'explicit', relatedCommits: [] })).toBe('direct');
  });

  it('sourceDetail=explicit → direct', () => {
    expect(resolveEvidenceBasis({ sourceDetail: 'explicit' })).toBe('direct');
  });

  it('sourceDetail=hook → undefined (neutral)', () => {
    expect(resolveEvidenceBasis({ sourceDetail: 'hook' })).toBeUndefined();
  });

  it('no fields → undefined (neutral, backward-compat)', () => {
    expect(resolveEvidenceBasis({})).toBeUndefined();
  });

  it('source=agent → undefined (not treated as git)', () => {
    expect(resolveEvidenceBasis({ source: 'agent' })).toBeUndefined();
  });

  it('commitHash overrides sourceDetail=explicit → repository wins', () => {
    expect(resolveEvidenceBasis({ sourceDetail: 'explicit', commitHash: 'abc' })).toBe('repository');
  });
});

// ── 2. evidenceBasisLine ─────────────────────────────────────────────

describe('evidenceBasisLine', () => {
  it('repository + commitHash → ✓ Repository-backed — commit <7 chars>', () => {
    const line = evidenceBasisLine('repository', 'abc1234ef');
    expect(line).toBe('✓ Repository-backed — commit abc1234');
  });

  it('repository without commitHash → ✓ Repository-backed (no commit suffix)', () => {
    expect(evidenceBasisLine('repository', undefined)).toBe('✓ Repository-backed');
  });

  it('direct → empty string (no annotation to avoid noise)', () => {
    expect(evidenceBasisLine('direct')).toBe('');
  });

  it('undefined → empty string', () => {
    expect(evidenceBasisLine(undefined)).toBe('');
  });
});

// ── 3. formatObservationDetail: verification line in provenance header ─

function makeDoc(overrides: Partial<Parameters<typeof formatObservationDetail>[0]> = {}) {
  return {
    observationId: 42,
    type: 'what-changed',
    title: 'Fix null pointer',
    narrative: 'Fixed a null pointer in auth.',
    facts: '',
    filesModified: '',
    concepts: '',
    createdAt: new Date('2025-01-01T00:00:00Z').toISOString(),
    projectId: 'test/project',
    entityName: 'auth',
    ...overrides,
  };
}

describe('formatObservationDetail: evidence basis in provenance header', () => {
  it('git-ingest + commitHash → shows ✓ Repository-backed — commit <hash>', () => {
    const out = formatObservationDetail(makeDoc({
      sourceDetail: 'git-ingest',
      commitHash: 'abc1234ef',
    }));
    expect(out).toContain('✓ Repository-backed — commit abc1234');
  });

  it('git-ingest no commitHash → shows ✓ Repository-backed (no hash)', () => {
    const out = formatObservationDetail(makeDoc({ sourceDetail: 'git-ingest' }));
    expect(out).toContain('✓ Repository-backed');
    expect(out).not.toContain('commit');
  });

  it('legacy source=git + commitHash → shows repository-backed with commit', () => {
    const out = formatObservationDetail(makeDoc({ source: 'git', commitHash: 'deadbeef' }));
    expect(out).toContain('✓ Repository-backed — commit deadbee');
  });

  it('source=git + relatedCommits → shows repository-backed', () => {
    const out = formatObservationDetail(makeDoc({
      sourceDetail: 'explicit',
      relatedCommits: ['abc1234'],
    }));
    expect(out).toContain('✓ Repository-backed');
  });

  it('explicit, no commits → no verification line (direct is silent)', () => {
    const out = formatObservationDetail(makeDoc({ sourceDetail: 'explicit' }));
    expect(out).not.toContain('Repository-backed');
    expect(out).not.toContain('✓');
  });

  it('hook trace → no verification line', () => {
    const out = formatObservationDetail(makeDoc({ sourceDetail: 'hook' }));
    expect(out).not.toContain('Repository-backed');
    expect(out).not.toContain('✓');
  });

  it('no sourceDetail, no source → no provenance header at all (backward-compat)', () => {
    const out = formatObservationDetail(makeDoc());
    expect(out).not.toContain('Repository-backed');
    expect(out).not.toContain('[L');
    expect(out.trimStart().startsWith('#42')).toBe(true);
  });

  it('#ID line still present after evidence header', () => {
    const out = formatObservationDetail(makeDoc({ sourceDetail: 'git-ingest', commitHash: 'abc1234' }));
    expect(out).toContain('#42');
  });

  it('verification line appears before #ID line', () => {
    const out = formatObservationDetail(makeDoc({ sourceDetail: 'git-ingest', commitHash: 'abc1234' }));
    expect(out.indexOf('Repository-backed')).toBeLessThan(out.indexOf('#42'));
  });

  it('core badge and repository-backed can coexist', () => {
    const out = formatObservationDetail(makeDoc({
      sourceDetail: 'git-ingest',
      valueCategory: 'core',
      commitHash: 'abc1234',
    }));
    expect(out).toContain('✓ Repository-backed');
    expect(out).toContain('★ Core');
  });
});

// ── 4. formatTimeline: anchor annotation with repository suffix ───────

function makeEntry(id: number, overrides: Partial<IndexEntry> = {}): IndexEntry {
  return {
    time: '1d ago',
    type: 'what-changed',
    icon: '🟢',
    title: `Entry ${id}`,
    tokens: 80,
    projectId: 'test/project',
    ...overrides,
    id,
  };
}

function makeTimeline(
  anchorId: number,
  anchor: IndexEntry,
  before: IndexEntry[] = [],
  after: IndexEntry[] = [],
): TimelineContext {
  return { anchorId, anchorEntry: anchor, before, after };
}

describe('formatTimeline: evidence basis in anchor annotation', () => {
  it('git anchor → annotation includes "— ✓ repository-backed"', () => {
    const anchor = makeEntry(10, { sourceDetail: 'git-ingest' });
    const out = formatTimeline(makeTimeline(10, anchor));
    expect(out).toContain('— ✓ repository-backed');
  });

  it('legacy source=git anchor → annotation includes "— ✓ repository-backed"', () => {
    const anchor = makeEntry(10, { source: 'git' });
    const out = formatTimeline(makeTimeline(10, anchor));
    expect(out).toContain('— ✓ repository-backed');
  });

  it('explicit anchor → no repository-backed suffix in annotation', () => {
    const anchor = makeEntry(10, { sourceDetail: 'explicit' });
    const out = formatTimeline(makeTimeline(10, anchor));
    expect(out).toContain('Expanding:');
    expect(out).not.toContain('repository-backed');
  });

  it('hook anchor → no repository-backed suffix in annotation', () => {
    const anchor = makeEntry(10, { sourceDetail: 'hook' });
    const out = formatTimeline(makeTimeline(10, anchor));
    expect(out).toContain('Expanding:');
    expect(out).not.toContain('repository-backed');
  });

  it('no-provenance anchor → no Expanding annotation at all (backward-compat)', () => {
    const anchor = makeEntry(10);
    const out = formatTimeline(makeTimeline(10, anchor));
    expect(out).not.toContain('Expanding:');
    expect(out).not.toContain('repository-backed');
  });

  it('non-anchor entry with git does not add repository-backed to annotation', () => {
    const anchor = makeEntry(10, { sourceDetail: 'explicit' });
    const before = makeEntry(9, { source: 'git' });
    const out = formatTimeline(makeTimeline(10, anchor, [before]));
    // Expanding should show explicit, NOT repository-backed
    expect(out).toContain('Expanding:');
    expect(out).not.toContain('repository-backed');
  });
});
