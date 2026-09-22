import { describe, expect, it } from 'vitest';
import { scoreMemoryQualityGate } from '../../src/evaluation/memory-quality-gate.js';

describe('memory quality gate', () => {
  it('measures recall, precision, scope, stale rejection, abstention, latency, and RSS', () => {
    const score = scoreMemoryQualityGate([
      {
        id: 'auth', expectedIds: ['a'], shownIds: ['a', 'noise'],
        tokens: 120, tokenBudget: 800, latencyMs: 20, rssBytes: 10_000,
      },
      {
        id: 'scope', expectedIds: ['b'], shownIds: ['b'], leakedProjectRows: 0,
        tokens: 100, tokenBudget: 800, latencyMs: 40, rssBytes: 12_000,
      },
      {
        id: 'abstain', expectedIds: [], shownIds: [], shouldAbstain: true,
        tokens: 20, tokenBudget: 800, latencyMs: 10, rssBytes: 9_000,
      },
    ]);

    expect(score).toMatchObject({
      cases: 3,
      recallAtK: 1,
      scopeIsolation: 1,
      staleRejection: 1,
      abstentionAccuracy: 1,
      overBudgetCases: 0,
      latencyP50Ms: 20,
      latencyP95Ms: 40,
      peakRssBytes: 12_000,
      passed: true,
    });
  });

  it('fails closed when stale or cross-project rows are surfaced', () => {
    const score = scoreMemoryQualityGate([{
      id: 'bad', expectedIds: ['a'], shownIds: ['a', 'stale'],
      staleRowsShown: 1, leakedProjectRows: 1,
      tokens: 900, tokenBudget: 800, latencyMs: 100,
    }]);
    expect(score.passed).toBe(false);
    expect(score.failures).toEqual(expect.arrayContaining([
      'bad: cross-project leakage',
      'bad: stale memory surfaced',
    ]));
  });
});
