import { describe, expect, it } from 'vitest';
import { applyMemoryFeedback } from '../../src/memory/feedback.js';

describe('memory feedback reducer', () => {
  it('strengthens verified use and archives conflicted weak evidence', () => {
    const start = { weight: 1, status: 'active' as const, audit: [] };
    const verified = applyMemoryFeedback(start, { signal: 'verification-success', at: '2026-08-23T00:00:00Z' });
    expect(verified.weight).toBe(1.25);
    const conflicted = applyMemoryFeedback({ ...verified, weight: 0.2 }, { signal: 'code-conflict', at: '2026-08-23T00:01:00Z' });
    expect(conflicted.status).toBe('archived');
    expect(conflicted.audit).toHaveLength(2);
  });
});
