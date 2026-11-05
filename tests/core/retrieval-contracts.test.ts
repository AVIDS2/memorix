import { describe, expect, it } from 'vitest';
import { createRetrievalPlan } from '../../src/core/retrieval-contracts.js';

describe('retrieval kernel contract', () => {
  it('normalizes host input before a derived view is selected', () => {
    const plan = createRetrievalPlan({
      query: '  exact title  ',
      limit: 99_999,
      quality: 'balanced',
      maxTokens: -3,
      surfacedIds: [3, 4],
      trackAccess: false,
      status: 'all',
    });

    expect(plan).toMatchObject({
      query: 'exact title',
      limit: 10_000,
      quality: 'balanced',
      maxTokens: 0,
      surfacedIds: [3, 4],
      trackAccess: false,
      status: 'all',
    });
  });
});
