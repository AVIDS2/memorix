/**
 * Phase 3: Timeline Provenance Tests
 *
 * Verifies that formatTimeline() adds Src column and anchor kind annotation
 * when entries carry sourceDetail provenance, and falls back to the original
 * table format when no provenance is present (backward-compat).
 */

import { describe, it, expect } from 'vitest';
import { formatTimeline } from '../../src/compact/index-format.js';
import type { IndexEntry, TimelineContext } from '../../src/types.js';

function makeEntry(overrides: Partial<IndexEntry> & { id: number }): IndexEntry {
  return {
    time: '1d ago',
    type: 'what-changed',
    icon: '🟢',
    title: `Entry ${overrides.id}`,
    tokens: 80,
    projectId: 'test/project',
    source: 'agent',
    ...overrides,
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

// ── Backward-compat: no sourceDetail → original format ──────────────

describe('Backward-compat: no provenance', () => {
  it('no Src column when no entries have sourceDetail', () => {
    const timeline = makeTimeline(
      10,
      makeEntry({ id: 10 }),
      [makeEntry({ id: 9 })],
      [makeEntry({ id: 11 })],
    );
    const out = formatTimeline(timeline);

    expect(out).not.toContain('| Src |');
    expect(out).not.toContain('Expanding:');
  });

  it('original table header preserved when no provenance', () => {
    const timeline = makeTimeline(5, makeEntry({ id: 5 }));
    const out = formatTimeline(timeline);

    expect(out).toContain('| ID | Time | T | Title | Tokens |');
    expect(out).not.toContain('| Src |');
  });

  it('#ID is always present in anchor row', () => {
    const timeline = makeTimeline(7, makeEntry({ id: 7 }));
    const out = formatTimeline(timeline);
    expect(out).toContain('#7');
  });

  it('returns not-found message for missing anchor', () => {
    const timeline: TimelineContext = { anchorId: 99, anchorEntry: null, before: [], after: [] };
    expect(formatTimeline(timeline)).toContain('not found');
  });
});

// ── Src column: shown when provenance present ─────────────────────────

describe('Src column with provenance', () => {
  it('shows Src column when anchor has sourceDetail', () => {
    const anchor = makeEntry({ id: 10, sourceDetail: 'hook' });
    const timeline = makeTimeline(10, anchor);
    const out = formatTimeline(timeline);

    expect(out).toContain('Src');
    expect(out).toContain('hk');
  });

  it('shows Src column when a before entry has sourceDetail', () => {
    const anchor = makeEntry({ id: 10 });
    const before = makeEntry({ id: 9, sourceDetail: 'explicit' });
    const timeline = makeTimeline(10, anchor, [before]);
    const out = formatTimeline(timeline);

    expect(out).toContain('Src');
  });

  it('Src badge correct for each sourceDetail value', () => {
    const anchor = makeEntry({ id: 20, sourceDetail: 'git-ingest' });
    const before = makeEntry({ id: 19, sourceDetail: 'hook' });
    const after = makeEntry({ id: 21, sourceDetail: 'explicit' });
    const timeline = makeTimeline(20, anchor, [before], [after]);
    const out = formatTimeline(timeline);

    expect(out).toContain('git');
    expect(out).toContain('hk');
    expect(out).toContain('ex');
  });

  it('entry without sourceDetail in mixed timeline shows dash badge', () => {
    const anchor = makeEntry({ id: 10, sourceDetail: 'explicit' });
    const before = makeEntry({ id: 9 }); // no sourceDetail
    const timeline = makeTimeline(10, anchor, [before]);
    const out = formatTimeline(timeline);

    // Src column present (anchor has sourceDetail)
    expect(out).toContain('Src');
    // No-sourceDetail entry gets '-'
    const rows = out.split('\n').filter((l) => l.includes('| #'));
    expect(rows.some((r) => r.includes('| - |'))).toBe(true);
  });
});

// ── Anchor kind annotation ────────────────────────────────────────────

describe('Anchor kind annotation', () => {
  it('shows Expanding annotation for hook anchor', () => {
    const anchor = makeEntry({ id: 45, sourceDetail: 'hook' });
    const timeline = makeTimeline(45, anchor);
    const out = formatTimeline(timeline);

    expect(out).toContain('Expanding:');
    expect(out).toContain('Hook Trace');
  });

  it('shows Expanding annotation for git-ingest anchor', () => {
    const anchor = makeEntry({ id: 22, sourceDetail: 'git-ingest' });
    const timeline = makeTimeline(22, anchor);
    const out = formatTimeline(timeline);

    expect(out).toContain('Expanding:');
    expect(out).toContain('Git Repository Evidence');
  });

  it('shows Expanding annotation for explicit anchor', () => {
    const anchor = makeEntry({ id: 12, sourceDetail: 'explicit' });
    const timeline = makeTimeline(12, anchor);
    const out = formatTimeline(timeline);

    expect(out).toContain('Expanding:');
    expect(out).toContain('Explicit Working Memory');
  });

  it('no Expanding annotation when anchor has no sourceDetail', () => {
    const anchor = makeEntry({ id: 10 }); // no sourceDetail
    const timeline = makeTimeline(10, anchor);
    const out = formatTimeline(timeline);

    expect(out).not.toContain('Expanding:');
  });

  it('Expanding annotation appears before **Anchor:** section', () => {
    const anchor = makeEntry({ id: 30, sourceDetail: 'hook' });
    const timeline = makeTimeline(30, anchor);
    const out = formatTimeline(timeline);

    const expandPos = out.indexOf('Expanding:');
    const anchorPos = out.indexOf('**Anchor:**');
    expect(expandPos).toBeLessThan(anchorPos);
  });
});

// ── Structure stability ───────────────────────────────────────────────

describe('Structure stability with provenance', () => {
  it('Timeline around #N: header always present', () => {
    const anchor = makeEntry({ id: 5, sourceDetail: 'explicit' });
    const out = formatTimeline(makeTimeline(5, anchor));
    expect(out).toContain('Timeline around #5:');
  });

  it('Before/Anchor/After section labels preserved', () => {
    const anchor = makeEntry({ id: 10, sourceDetail: 'hook' });
    const before = makeEntry({ id: 9, sourceDetail: 'hook' });
    const after = makeEntry({ id: 11, sourceDetail: 'hook' });
    const out = formatTimeline(makeTimeline(10, anchor, [before], [after]));

    expect(out).toContain('**Before:**');
    expect(out).toContain('**Anchor:**');
    expect(out).toContain('**After:**');
  });

  it('Progressive Disclosure hint still present', () => {
    const anchor = makeEntry({ id: 10, sourceDetail: 'explicit' });
    const out = formatTimeline(makeTimeline(10, anchor));
    expect(out).toContain('Progressive Disclosure');
  });
});
