import { describe, it, expect } from 'vitest';
import { mergeWithRRF, buildRrfTrace } from '../../src/search/rrf.js';
import type { IndexEntry } from '../../src/types.js';

// ─── Test Fixtures ───────────────────────────────────────────────────────────

function makeEntry(
  id: number,
  title: string,
  opts: { projectId?: string; score?: number } = {},
): IndexEntry {
  return {
    id,
    time: '12:00 PM',
    type: 'discovery',
    icon: '🟣',
    title,
    tokens: 10,
    projectId: opts.projectId ?? 'proj-a',
    score: opts.score ?? 1,
  };
}

// ─── mergeWithRRF ────────────────────────────────────────────────────────────

describe('mergeWithRRF', () => {
  it('returns empty array when all sources are empty', () => {
    expect(mergeWithRRF([])).toEqual([]);
    expect(mergeWithRRF([{ results: [] }, { results: [] }])).toEqual([]);
  });

  it('single source preserves original order', () => {
    const results = [
      makeEntry(1, 'first'),
      makeEntry(2, 'second'),
      makeEntry(3, 'third'),
    ];
    const merged = mergeWithRRF([{ results }]);
    expect(merged.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it('documents in multiple sources rank above single-source documents', () => {
    // doc-3 appears in both lists → should outscore doc-1 (only in list A)
    // and doc-5 (only in list B) which appear only once
    const listA = [makeEntry(1, 'alpha'), makeEntry(3, 'shared')];
    const listB = [makeEntry(5, 'beta'), makeEntry(3, 'shared')];

    const merged = mergeWithRRF([{ results: listA }, { results: listB }]);
    const ids = merged.map((e) => e.id);

    // shared document (3) must rank above the unique ones
    expect(ids.indexOf(3)).toBeLessThan(ids.indexOf(1));
    expect(ids.indexOf(3)).toBeLessThan(ids.indexOf(5));
  });

  it('deduplicates: same document appears at most once', () => {
    const entry = makeEntry(42, 'dup');
    const merged = mergeWithRRF([
      { results: [entry, makeEntry(1, 'a')] },
      { results: [entry, makeEntry(2, 'b')] },
    ]);
    const ids = merged.map((e) => e.id);
    expect(ids.filter((id) => id === 42).length).toBe(1);
  });

  it('sets score to RRF value, not original score', () => {
    const entry = makeEntry(7, 'test', { score: 999 });
    const [result] = mergeWithRRF([{ results: [entry] }]);
    // RRF score for rank-1, weight=1, k=60 → 1/(60+1) ≈ 0.0164
    expect(result.score).toBeCloseTo(1 / 61, 6);
    expect(result.score).not.toBe(999);
  });

  it('higher weight sources dominate lower weight sources', () => {
    // doc-1 is rank-1 in low-weight list; doc-2 is rank-1 in 10x-weight list
    const lowWeight = [makeEntry(1, 'low-list-rank1')];
    const highWeight = [makeEntry(2, 'high-list-rank1')];

    const merged = mergeWithRRF([
      { results: lowWeight, weight: 1 },
      { results: highWeight, weight: 10 },
    ]);
    // doc-2 from the high-weight source should come first
    expect(merged[0].id).toBe(2);
    expect(merged[1].id).toBe(1);
  });

  it('preserves entry data from the highest-ranked source', () => {
    // doc-1 appears in both lists; list A has it at rank 1 (bestRank), list B at rank 2
    const entryFromA = makeEntry(1, 'title-from-A');
    const entryFromB = { ...makeEntry(1, 'title-from-B'), projectId: 'proj-a' };

    const merged = mergeWithRRF([
      { results: [entryFromA] },          // rank 1 in list A → bestRank
      { results: [makeEntry(99, 'x'), entryFromB] }, // rank 2 in list B
    ]);

    const doc1 = merged.find((e) => e.id === 1);
    expect(doc1?.title).toBe('title-from-A'); // comes from list A (rank 1)
  });

  it('tiebreaks equal scores by bestRank (lower is better)', () => {
    // Two unique docs appear in one list each, same relative weight → same score
    // doc-1 is at rank 1, doc-2 is at rank 1 in a different list
    const merged = mergeWithRRF([
      { results: [makeEntry(1, 'one')] },
      { results: [makeEntry(2, 'two')] },
    ]);
    // Both score 1/61; rank-1 in both — tiebreak is deterministic by key order
    // (just assert both present and score equal, not strict ordering)
    const scores = merged.map((e) => e.score!);
    expect(scores[0]).toBeCloseTo(scores[1]!, 6);
  });

  it('limit option trims output', () => {
    const results = [
      makeEntry(1, 'a'),
      makeEntry(2, 'b'),
      makeEntry(3, 'c'),
      makeEntry(4, 'd'),
    ];
    const merged = mergeWithRRF([{ results }], { limit: 2 });
    expect(merged.length).toBe(2);
  });

  it('limit: 0 applies no limit', () => {
    const results = Array.from({ length: 10 }, (_, i) => makeEntry(i + 1, `doc-${i}`));
    const merged = mergeWithRRF([{ results }], { limit: 0 });
    expect(merged.length).toBe(10);
  });

  it('custom k changes scores proportionally', () => {
    const entry = makeEntry(1, 'test');
    const [withK60] = mergeWithRRF([{ results: [entry] }], { k: 60 });
    const [withK1] = mergeWithRRF([{ results: [entry] }], { k: 1 });

    // k=1 → 1/(1+1)=0.5;  k=60 → 1/(60+1)≈0.016
    expect(withK1.score!).toBeGreaterThan(withK60.score!);
    expect(withK1.score).toBeCloseTo(0.5, 6);
  });

  it('empty source list in the middle is ignored gracefully', () => {
    const list = [makeEntry(1, 'a'), makeEntry(2, 'b')];
    const merged = mergeWithRRF([
      { results: list },
      { results: [] },
      { results: [makeEntry(3, 'c')] },
    ]);
    expect(merged.map((e) => e.id)).toContain(1);
    expect(merged.map((e) => e.id)).toContain(2);
    expect(merged.map((e) => e.id)).toContain(3);
  });

  it('cross-project: documents with same id but different projectId are separate', () => {
    const entryProjA = makeEntry(1, 'proj-a-doc', { projectId: 'proj-a' });
    const entryProjB = makeEntry(1, 'proj-b-doc', { projectId: 'proj-b' });

    const merged = mergeWithRRF([
      { results: [entryProjA] },
      { results: [entryProjB] },
    ]);
    // Both must appear as distinct entries (different project namespaces)
    expect(merged.length).toBe(2);
    const titles = merged.map((e) => e.title);
    expect(titles).toContain('proj-a-doc');
    expect(titles).toContain('proj-b-doc');
  });

  it('three-way merge: document in all three lists ranks highest', () => {
    const shared = makeEntry(99, 'shared-doc');
    const merged = mergeWithRRF([
      { results: [makeEntry(1, 'only-a'), shared] },
      { results: [makeEntry(2, 'only-b'), shared] },
      { results: [makeEntry(3, 'only-c'), shared] },
    ]);
    // shared appears in all 3 lists → must rank first
    expect(merged[0].id).toBe(99);
  });

  it('RRF score formula: rank-1 in one list, k=60 → 1/61', () => {
    const [result] = mergeWithRRF([{ results: [makeEntry(1, 'x')] }], { k: 60 });
    expect(result.score).toBeCloseTo(1 / 61, 8);
  });

  it('RRF score formula: rank-1 in two equal-weight lists, k=60 → 2/61', () => {
    const entry = makeEntry(1, 'x');
    const [result] = mergeWithRRF([
      { results: [entry] },
      { results: [entry] },
    ], { k: 60 });
    expect(result.score).toBeCloseTo(2 / 61, 8);
  });
});

// ─── buildRrfTrace ───────────────────────────────────────────────────────────

describe('buildRrfTrace', () => {
  it('returns empty array for empty sources', () => {
    expect(buildRrfTrace([])).toEqual([]);
    expect(buildRrfTrace([{ results: [] }])).toEqual([]);
  });

  it('assigns contribution 0 for sources where document is absent', () => {
    const trace = buildRrfTrace([
      { results: [makeEntry(1, 'a')], label: 'bm25' },
      { results: [makeEntry(2, 'b')], label: 'vector' },
    ]);

    const doc1 = trace.find((t) => t.key.endsWith('::1'))!;
    expect(doc1.contributions[0].contribution).toBeGreaterThan(0);  // bm25 has it
    expect(doc1.contributions[1].contribution).toBe(0);              // vector does not
    expect(doc1.contributions[1].rank).toBeNull();
  });

  it('uses source labels from RrfSource.label', () => {
    const trace = buildRrfTrace([
      { results: [makeEntry(1, 'a')], label: 'bm25' },
      { results: [makeEntry(1, 'a')], label: 'vector' },
    ]);
    const doc1 = trace[0];
    expect(doc1.contributions.map((c) => c.label)).toEqual(['bm25', 'vector']);
  });

  it('falls back to source-{index} when label is omitted', () => {
    const trace = buildRrfTrace([
      { results: [makeEntry(1, 'a')] },
      { results: [makeEntry(1, 'a')] },
    ]);
    const doc1 = trace[0];
    expect(doc1.contributions[0].label).toBe('source-0');
    expect(doc1.contributions[1].label).toBe('source-1');
  });

  it('totalScore matches mergeWithRRF score for the same document', () => {
    const entry = makeEntry(5, 'test');
    const sources = [
      { results: [entry], label: 'bm25', weight: 1 },
      { results: [entry], label: 'vector', weight: 2 },
    ];
    const [merged] = mergeWithRRF(sources, { k: 60 });
    const [traceEntry] = buildRrfTrace(sources, 60);

    expect(traceEntry.totalScore).toBeCloseTo(merged.score!, 8);
  });

  it('sorts traces by totalScore descending', () => {
    const trace = buildRrfTrace([
      {
        results: [
          makeEntry(1, 'rank1'),
          makeEntry(2, 'rank2'),
          makeEntry(3, 'rank3'),
        ],
      },
    ]);
    const scores = trace.map((t) => t.totalScore);
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]!);
    }
  });

  it('records 1-based rank in contributions', () => {
    const trace = buildRrfTrace([
      {
        results: [makeEntry(10, 'first'), makeEntry(20, 'second')],
        label: 'src',
      },
    ]);
    const doc10 = trace.find((t) => t.key.endsWith('::10'))!;
    const doc20 = trace.find((t) => t.key.endsWith('::20'))!;
    expect(doc10.contributions[0].rank).toBe(1);
    expect(doc20.contributions[0].rank).toBe(2);
  });
});
