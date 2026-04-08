/**
 * Phase 3 Compat: Legacy source='git' regression tests
 *
 * Covers the four surfaces where legacy git memories (source='git',
 * no sourceDetail) must behave identically to modern sourceDetail='git-ingest':
 *   1. disclosure-policy: classifyLayer / sourceBadge / resolveSourceDetail
 *   2. search/table: search badge + tier summary (formatIndexTable)
 *   3. detail: provenance header (formatObservationDetail)
 *   4. timeline: anchor annotation + Src column (formatTimeline)
 *
 * session_start path is covered via classifyLayer, which getSessionContext calls.
 */

import { describe, it, expect } from 'vitest';
import { classifyLayer, sourceBadge, resolveSourceDetail } from '../../src/memory/disclosure-policy.js';
import { formatIndexTable, formatObservationDetail, formatTimeline } from '../../src/compact/index-format.js';
import type { IndexEntry, TimelineContext } from '../../src/types.js';

// ── 1. disclosure-policy ────────────────────────────────────────────

describe('resolveSourceDetail: legacy source=git fallback', () => {
  it('source=git with no sourceDetail → git-ingest', () => {
    expect(resolveSourceDetail(undefined, 'git')).toBe('git-ingest');
  });

  it('source=git is overridden by explicit sourceDetail', () => {
    expect(resolveSourceDetail('explicit', 'git')).toBe('explicit');
    expect(resolveSourceDetail('hook', 'git')).toBe('hook');
    expect(resolveSourceDetail('git-ingest', 'git')).toBe('git-ingest');
  });

  it('no sourceDetail and source=agent → undefined (not treated as git)', () => {
    expect(resolveSourceDetail(undefined, 'agent')).toBeUndefined();
  });

  it('no sourceDetail and no source → undefined', () => {
    expect(resolveSourceDetail()).toBeUndefined();
  });
});

describe('classifyLayer: legacy source=git → L3', () => {
  it('source=git with no sourceDetail → L3', () => {
    expect(classifyLayer({ source: 'git' })).toBe('L3');
  });

  it('source=git + valueCategory=core → still L2 (core promotion wins)', () => {
    expect(classifyLayer({ source: 'git', valueCategory: 'core' })).toBe('L2');
  });

  it('source=agent with no sourceDetail → L2 (not mistaken for git)', () => {
    expect(classifyLayer({ source: 'agent' })).toBe('L2');
  });

  it('modern sourceDetail=git-ingest → L3 (unchanged)', () => {
    expect(classifyLayer({ sourceDetail: 'git-ingest' })).toBe('L3');
  });

  it('no source, no sourceDetail → L2 (backward-compat for truly unknown obs)', () => {
    expect(classifyLayer({})).toBe('L2');
  });
});

describe('sourceBadge: legacy source=git fallback', () => {
  it('source=git with no sourceDetail → git badge', () => {
    expect(sourceBadge(undefined, 'git')).toBe('git');
  });

  it('source=git is overridden by modern sourceDetail', () => {
    expect(sourceBadge('explicit', 'git')).toBe('ex');
    expect(sourceBadge('hook', 'git')).toBe('hk');
  });

  it('source=agent → empty badge (not treated as git)', () => {
    expect(sourceBadge(undefined, 'agent')).toBe('');
  });
});

// ── 2. search/table: formatIndexTable ───────────────────────────────

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

describe('formatIndexTable: legacy source=git', () => {
  it('shows Src column when entry has source=git (no sourceDetail)', () => {
    const entries = [makeEntry(1, { source: 'git' })];
    const out = formatIndexTable(entries);
    expect(out).toContain('Src');
    expect(out).toContain('git');
  });

  it('legacy git entry shows git badge in table row', () => {
    const entries = [makeEntry(1, { source: 'git' })];
    const out = formatIndexTable(entries);
    // Row should have git badge
    const row = out.split('\n').find((l) => l.includes('| obs:1'));
    expect(row).toBeDefined();
    expect(row).toContain('git');
  });

  it('tier summary includes git count for legacy entries', () => {
    const entries = [
      makeEntry(1, { sourceDetail: 'explicit' }),
      makeEntry(2, { source: 'git' }),
    ];
    const out = formatIndexTable(entries);
    // Mixed provenance → tier summary line
    expect(out).toContain('Sources:');
    expect(out).toContain('git');
    expect(out).toContain('explicit');
  });

  it('no Src column when no entries have provenance (backward-compat)', () => {
    const entries = [makeEntry(1), makeEntry(2)];
    const out = formatIndexTable(entries);
    expect(out).not.toContain('| Src |');
  });
});

// ── 3. detail: formatObservationDetail ──────────────────────────────

function makeDoc(overrides: Partial<Parameters<typeof formatObservationDetail>[0]> = {}) {
  return {
    observationId: 55,
    type: 'what-changed',
    title: 'Legacy git commit',
    narrative: 'Fixed null pointer.',
    facts: '',
    filesModified: '',
    concepts: '',
    createdAt: new Date('2025-01-01T00:00:00Z').toISOString(),
    projectId: 'test/project',
    entityName: 'auth',
    ...overrides,
  };
}

describe('formatObservationDetail: legacy source=git', () => {
  it('source=git (no sourceDetail) → shows Git Repository Evidence header', () => {
    const out = formatObservationDetail(makeDoc({ source: 'git' }));
    expect(out).toContain('Git Repository Evidence');
    expect(out).toContain('L3');
  });

  it('#ID line still present after provenance header', () => {
    const out = formatObservationDetail(makeDoc({ source: 'git' }));
    expect(out).toContain('#55');
  });

  it('provenance header before #ID line', () => {
    const out = formatObservationDetail(makeDoc({ source: 'git' }));
    expect(out.indexOf('Git Repository Evidence')).toBeLessThan(out.indexOf('#55'));
  });

  it('source=git + valueCategory=core → shows Git Evidence header + ★ Core', () => {
    const out = formatObservationDetail(makeDoc({ source: 'git', valueCategory: 'core' }));
    expect(out).toContain('Git Repository Evidence');
    expect(out).toContain('★ Core');
  });

  it('modern sourceDetail=git-ingest still works (no regression)', () => {
    const out = formatObservationDetail(makeDoc({ sourceDetail: 'git-ingest' }));
    expect(out).toContain('Git Repository Evidence');
  });

  it('no source, no sourceDetail → no provenance header (backward-compat)', () => {
    const out = formatObservationDetail(makeDoc());
    expect(out).not.toContain('Evidence');
    expect(out).not.toContain('[L');
    expect(out.trimStart().startsWith('#55')).toBe(true);
  });
});

// ── 4. timeline: formatTimeline ──────────────────────────────────────

function makeTimeline(
  anchorId: number,
  anchor: IndexEntry,
  before: IndexEntry[] = [],
  after: IndexEntry[] = [],
): TimelineContext {
  return { anchorId, anchorEntry: anchor, before, after };
}

describe('formatTimeline: legacy source=git', () => {
  it('anchor source=git → shows Expanding: Git Repository Evidence', () => {
    const anchor = makeEntry(22, { source: 'git' });
    const out = formatTimeline(makeTimeline(22, anchor));
    expect(out).toContain('Expanding:');
    expect(out).toContain('Git Repository Evidence');
  });

  it('anchor source=git → Src column present', () => {
    const anchor = makeEntry(22, { source: 'git' });
    const out = formatTimeline(makeTimeline(22, anchor));
    expect(out).toContain('Src');
    expect(out).toContain('git');
  });

  it('before entry with source=git triggers Src column on all rows', () => {
    const anchor = makeEntry(22);         // no provenance
    const before = makeEntry(21, { source: 'git' });
    const out = formatTimeline(makeTimeline(22, anchor, [before]));
    expect(out).toContain('Src');
    // Anchor row (no provenance) gets dash
    const rows = out.split('\n').filter((l) => l.includes('| #'));
    expect(rows.some((r) => r.includes('| - |'))).toBe(true);
    // Before row gets git badge
    expect(rows.some((r) => r.includes('git'))).toBe(true);
  });

  it('modern sourceDetail=git-ingest still works in timeline (no regression)', () => {
    const anchor = makeEntry(10, { sourceDetail: 'git-ingest' });
    const out = formatTimeline(makeTimeline(10, anchor));
    expect(out).toContain('Git Repository Evidence');
    expect(out).toContain('git');
  });

  it('no source, no sourceDetail → no Src column, no Expanding (backward-compat)', () => {
    const anchor = makeEntry(5);
    const out = formatTimeline(makeTimeline(5, anchor));
    expect(out).not.toContain('Src');
    expect(out).not.toContain('Expanding:');
  });
});

// ── 5. session_start path: classifyLayer is the gate ────────────────
// (getSessionContext calls classifyLayer(obs) where obs has source='git')
// Covered by classifyLayer tests above. Full integration covered by
// session-layered.test.ts with explicit provenance.
