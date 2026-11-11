import { describe, expect, it } from 'vitest';
import { createRetrievalFacade } from '../../src/core/retrieval-facade.js';

describe('retrieval facade', () => {
  it('keeps concurrent receipts attached to their own request', async () => {
    const pending = new Map<string, (value: any) => void>();
    const facade = createRetrievalFacade((plan) => new Promise((resolve) => {
      pending.set(plan.query, resolve);
    }));

    const first = facade.search({ query: 'first', projectId: 'org/repo' });
    const second = facade.search({ query: 'second', projectId: 'org/repo' });
    const receipt = (mode: string) => ({
      version: '1' as const,
      mode,
      candidateCount: 1,
      selectedCount: 1,
      omittedCount: 0,
      omittedByTokenBudget: 0,
      fallbackUsed: mode === 'fallback',
      elapsedMs: 1,
    });
    pending.get('second')!({ entries: [], receipt: receipt('fallback'), views: {} });
    pending.get('first')!({ entries: [], receipt: receipt('hybrid'), views: {} });

    expect((await first).receipt.mode).toBe('hybrid');
    expect((await second).receipt.mode).toBe('fallback');
  });
});
