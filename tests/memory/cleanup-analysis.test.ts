import { describe, expect, it } from 'vitest';

import { analyzeCleanupObservations } from '../../src/memory/cleanup.js';
import type { Observation } from '../../src/types.js';

function observation(id: number, title: string, overrides: Partial<Observation> = {}): Observation {
  return {
    id,
    entityName: 'auth',
    type: 'discovery',
    title,
    narrative: 'Durable project information.',
    facts: [],
    filesModified: [],
    concepts: [],
    tokens: 10,
    createdAt: new Date(2026, 0, id).toISOString(),
    projectId: 'test/project',
    status: 'active',
    ...overrides,
  };
}

describe('cleanup analysis', () => {
  it('keeps one canonical exact duplicate and separates low-quality records', () => {
    const canonical = observation(1, 'Stable auth decision');
    const duplicate = observation(2, 'Stable auth decision');
    const lowQuality = observation(3, 'Updated auth.ts');

    const result = analyzeCleanupObservations([canonical, duplicate, lowQuality]);

    expect(result.lowQuality.map((item) => item.id)).toEqual([3]);
    expect(result.duplicateGroups).toEqual([{ canonical, duplicates: [duplicate] }]);
    expect(result.toRemove.map((item) => item.id)).toEqual([3, 2]);
    expect(result.highQuality).toBe(1);
  });

  it('archives noise only when explicitly requested', () => {
    const noise = observation(1, '[benchmark] sandbox result');

    expect(analyzeCleanupObservations([noise]).toArchive).toEqual([]);
    const optedIn = analyzeCleanupObservations([noise], { includeNoise: true });
    expect(optedIn.noise).toMatchObject([{ observation: { id: 1 }, reason: 'demo/test/noise' }]);
    expect(optedIn.toArchive.map((item) => item.id)).toEqual([1]);
  });

  it('does not classify normal engineering language as cleanup noise', () => {
    const durable = [
      observation(1, '1.0.7 canonical storage rule set'),
      observation(2, 'Phase tasks issued as colleague handoffs'),
      observation(3, 'Read-only sandbox blocks local writes'),
      observation(4, 'Memorix API compatibility contract'),
      observation(5, 'test(stress): deterministic stress exams for the stability gate'),
    ];

    const analysis = analyzeCleanupObservations(durable, { includeNoise: true });
    expect(analysis.noise).toEqual([]);
    expect(analysis.toArchive).toEqual([]);
  });

  it('recognizes explicit fixture markers and tool receipts', () => {
    const fixture = observation(1, 'Synthetic record', { concepts: ['test-fixture'] });
    const receipt = observation(2, 'Used apply_patch');

    const analysis = analyzeCleanupObservations([fixture, receipt], { includeNoise: true });
    expect(analysis.toArchive.map((item) => item.id)).toEqual([1, 2]);
  });

  it('ignores records that are not active', () => {
    const archived = observation(1, 'Updated old.ts', { status: 'archived' });
    expect(analyzeCleanupObservations([archived]).totalActive).toBe(0);
  });
});
