/**
 * Retention immunity parity test (Gap #7)
 *
 * Guards that HTTP/dashboard callsites use the canonical isImmune() from
 * retention.ts instead of stale inline `importance >= 8 || type === gotcha/decision`
 * checks. A bare gotcha/decision must NOT be permanently immune.
 */

import { describe, it, expect } from 'vitest';
import { isImmune } from '../../src/memory/retention.js';
import type { MemorixDocument } from '../../src/types.js';

function makeDoc(overrides: Partial<MemorixDocument> = {}): MemorixDocument {
  return {
    id: 'obs-1',
    observationId: 1,
    entityName: 'test',
    type: 'decision',
    title: 'Test',
    narrative: 'Test narrative',
    facts: '',
    filesModified: '',
    concepts: '',
    tokens: 50,
    createdAt: new Date().toISOString(),
    projectId: 'test',
    accessCount: 0,
    lastAccessedAt: '',
    status: 'active',
    source: 'agent',
    sourceDetail: '',
    valueCategory: '',
    ...overrides,
  };
}

describe('Retention immunity parity (Gap #7)', () => {
  it('bare gotcha (no core, no protected tags, low access) is NOT immune', () => {
    const doc = makeDoc({ type: 'gotcha', valueCategory: '', concepts: '', accessCount: 0 });
    expect(isImmune(doc)).toBe(false);
  });

  it('bare decision is NOT immune (stale inline check wrongly said true)', () => {
    const doc = makeDoc({ type: 'decision', valueCategory: '', concepts: '', accessCount: 0 });
    expect(isImmune(doc)).toBe(false);
  });

  it('core valueCategory observation IS immune', () => {
    const doc = makeDoc({ type: 'gotcha', valueCategory: 'core' });
    expect(isImmune(doc)).toBe(true);
  });

  it('probe observation is NOT immune', () => {
    const doc = makeDoc({ type: 'probe', valueCategory: 'core', accessCount: 99, concepts: 'pinned' });
    expect(isImmune(doc)).toBe(false);
  });

  // --- Runtime shape guard (Gap #7 blocker) ---------------------------------
  // Raw loaded Observation.concepts is a string[] at runtime. isImmune calls
  // .split on concepts, so passing a raw array throws. Callsites use this same
  // adapter to join concepts to a string first.
  function toImmuneDoc(obs: unknown): MemorixDocument {
    const o = obs as Record<string, unknown>;
    return {
      ...o,
      concepts: Array.isArray(o.concepts) ? o.concepts.join(', ') : ((o.concepts as string) ?? ''),
    } as unknown as MemorixDocument;
  }

  it('raw array concepts passed directly to isImmune THROWS (why the adapter exists)', () => {
    const raw = { ...makeDoc({ type: 'gotcha', accessCount: 0 }), concepts: ['foo', 'bar'] } as unknown as MemorixDocument;
    expect(() => isImmune(raw)).toThrow();
  });

  it('callsite adapter joins string[] concepts: does NOT throw and gotcha is NOT immune', () => {
    const raw = { type: 'gotcha', accessCount: 0, valueCategory: '', concepts: ['foo', 'bar'] };
    let result: boolean | undefined;
    expect(() => { result = isImmune(toImmuneDoc(raw)); }).not.toThrow();
    expect(result).toBe(false);
  });

  it('callsite adapter preserves protected tags in string[] concepts (immune)', () => {
    const raw = { type: 'gotcha', accessCount: 0, valueCategory: '', concepts: ['pinned', 'foo'] };
    expect(isImmune(toImmuneDoc(raw))).toBe(true);
  });
});
