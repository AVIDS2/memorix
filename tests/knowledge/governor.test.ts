import { describe, expect, it } from 'vitest';
import { governContextCandidates } from '../../src/knowledge/governor.js';

describe('context evidence governor', () => {
  it('keeps current source-backed evidence and refuses out-of-scope, conflicting, or blocked candidates', () => {
    const plan = governContextCandidates([
      {
        kind: 'claim', id: 'claim:release', estimatedTokens: 12, relevance: 0.9,
        scopeAllowed: true, freshness: 'current', trust: 'source-backed', quality: 'verified', evidenceCount: 2,
      },
      {
        kind: 'memory', id: 'memory:other-project', estimatedTokens: 10, relevance: 1,
        scopeAllowed: false, freshness: 'current', trust: 'source-backed', quality: 'verified',
      },
      {
        kind: 'workflow', id: 'workflow:conflict', estimatedTokens: 10, relevance: 0.8,
        scopeAllowed: true, conflict: 'confirmed', quality: 'verified',
      },
      {
        kind: 'knowledge-page', id: 'page:blocked', estimatedTokens: 10, relevance: 0.8,
        scopeAllowed: true, quality: 'blocked',
      },
    ], 40);

    expect(plan.mode).toBe('workset');
    expect(plan.budget.usedTokens).toBe(12);
    expect(plan.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidate: expect.objectContaining({ id: 'claim:release' }), disposition: 'include', reasons: ['current-source-backed-evidence'] }),
      expect.objectContaining({ candidate: expect.objectContaining({ id: 'memory:other-project' }), disposition: 'exclude', reasons: ['scope-forbidden'] }),
      expect.objectContaining({ candidate: expect.objectContaining({ id: 'workflow:conflict' }), disposition: 'exclude', reasons: ['confirmed-conflict'] }),
      expect.objectContaining({ candidate: expect.objectContaining({ id: 'page:blocked' }), disposition: 'exclude', reasons: ['blocked-quality'] }),
    ]));
  });

  it('downgrades uncertain evidence to a compact card and keeps stale evidence out of the prompt', () => {
    const plan = governContextCandidates([
      {
        kind: 'memory', id: 'memory:unknown', estimatedTokens: 8, relevance: 0.8,
        scopeAllowed: true, freshness: 'unknown', trust: 'historical', quality: 'probationary',
      },
      {
        kind: 'code-state', id: 'snapshot:old', estimatedTokens: 8, relevance: 1,
        scopeAllowed: true, freshness: 'stale', trust: 'source-backed', quality: 'verified',
      },
    ], 24);

    expect(plan.mode).toBe('card');
    expect(plan.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidate: expect.objectContaining({ id: 'memory:unknown' }), disposition: 'compact', reasons: expect.arrayContaining(['unknown-freshness', 'probationary-evidence']) }),
      expect.objectContaining({ candidate: expect.objectContaining({ id: 'snapshot:old' }), disposition: 'defer', reasons: ['stale-evidence'] }),
    ]));
    expect(plan.cautions).toEqual(expect.arrayContaining(['unknown-freshness', 'stale-evidence']));
  });

  it('degrades lower-priority candidates when the token budget is exhausted instead of cutting them', () => {
    const plan = governContextCandidates([
      {
        kind: 'claim', id: 'claim:high', estimatedTokens: 9, relevance: 1,
        scopeAllowed: true, freshness: 'current', trust: 'source-backed', quality: 'verified',
      },
      {
        kind: 'durable-memory', id: 'durable:low', estimatedTokens: 9, relevance: 0.1,
        scopeAllowed: true, freshness: 'current', trust: 'source-backed', quality: 'verified',
      },
    ], 10);

    expect(plan.mode).toBe('workset');
    expect(plan.budget).toEqual({ maxTokens: 10, usedTokens: 9 });
    expect(plan.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidate: expect.objectContaining({ id: 'claim:high' }), disposition: 'include' }),
      expect.objectContaining({ candidate: expect.objectContaining({ id: 'durable:low' }), disposition: 'defer', reasons: expect.arrayContaining(['token-budget']) }),
    ]));
  });

  it('abstains when no candidate is safe to deliver', () => {
    const plan = governContextCandidates([{
      kind: 'memory', estimatedTokens: 5, relevance: 1, scopeAllowed: false,
    }], 20);

    expect(plan.mode).toBe('abstain');
    expect(plan.budget.usedTokens).toBe(0);
    expect(plan.cautions).toContain('scope-forbidden');
  });
});
