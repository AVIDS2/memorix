/**
 * Retention immunity parity test (Gap #7)
 *
 * Guards that HTTP/dashboard callsites use the canonical isImmune() from
 * retention.ts instead of stale inline `importance >= 8 || type === gotcha/decision`
 * checks. A bare gotcha/decision must NOT be permanently immune.
 */

import { describe, it, expect } from 'vitest';
import {
  isImmune,
  projectObservationRetention,
  summarizeRetentionProjections,
  toRetentionDocument,
} from '../../src/memory/retention.js';
import type { MemorixDocument, Observation } from '../../src/types.js';

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

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: 1,
    entityName: 'test',
    type: 'decision',
    title: 'Test',
    narrative: 'Test narrative',
    facts: [],
    filesModified: [],
    concepts: [],
    tokens: 50,
    createdAt: new Date().toISOString(),
    projectId: 'test',
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

  it('raw array concepts passed directly to isImmune throws', () => {
    const raw = { ...makeDoc({ type: 'gotcha', accessCount: 0 }), concepts: ['foo', 'bar'] } as unknown as MemorixDocument;
    expect(() => isImmune(raw)).toThrow();
  });

  it('central adapter joins string[] concepts: does not throw and gotcha is not immune', () => {
    const raw = makeObservation({ type: 'gotcha', concepts: ['foo', 'bar'] });
    expect(() => isImmune(toRetentionDocument(raw))).not.toThrow();
    expect(isImmune(toRetentionDocument(raw))).toBe(false);
  });

  it('central projection preserves protected tags and canonical lifecycle state', () => {
    const referenceTime = new Date('2026-07-27T00:00:00.000Z');
    const raw = makeObservation({
      type: 'gotcha',
      concepts: ['pinned', 'foo'],
      createdAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
    });

    const projection = projectObservationRetention(raw, { referenceTime });
    expect(projection.immune).toBe(true);
    expect(projection.zone).toBe('active');
    expect(projection.accessCount).toBe(0);
  });

  it('summarizes lifecycle zones instead of applying display-score thresholds', () => {
    const referenceTime = new Date('2026-07-27T00:00:00.000Z');
    const projections = [
      projectObservationRetention(makeObservation({
        id: 1,
        type: 'decision',
        valueCategory: 'core',
        createdAt: '2025-01-01T00:00:00.000Z',
      }), { referenceTime }),
      projectObservationRetention(makeObservation({
        id: 2,
        type: 'session-request',
        createdAt: '2026-05-01T00:00:00.000Z',
      }), { referenceTime }),
      projectObservationRetention(makeObservation({
        id: 3,
        type: 'how-it-works',
        createdAt: '2026-06-10T00:00:00.000Z',
      }), { referenceTime }),
    ];

    expect(summarizeRetentionProjections(projections)).toEqual({
      active: 1,
      stale: 1,
      archiveCandidates: 1,
      immune: 1,
    });
  });
});
