import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RERANK_TIMEOUT_MS,
  RERANK_TIMEOUT_MAX_MS,
  RERANK_TIMEOUT_MIN_MS,
  parseRerankTimeoutMs,
  resolveRerankTimeoutMs,
  shouldAttemptHttpRerank,
  shouldAttemptLlmRerank,
} from '../../src/rerank/policy.js';

describe('parseRerankTimeoutMs', () => {
  it('returns 30s when the env var is unset or empty', () => {
    expect(parseRerankTimeoutMs(undefined)).toBe(DEFAULT_RERANK_TIMEOUT_MS);
    expect(parseRerankTimeoutMs('')).toBe(DEFAULT_RERANK_TIMEOUT_MS);
    expect(parseRerankTimeoutMs('   ')).toBe(DEFAULT_RERANK_TIMEOUT_MS);
  });

  it('parses a valid positive integer', () => {
    expect(parseRerankTimeoutMs('45000')).toBe(45_000);
  });

  it('falls back to default and warns on invalid values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(parseRerankTimeoutMs('not-a-number')).toBe(DEFAULT_RERANK_TIMEOUT_MS);
    expect(parseRerankTimeoutMs('1500.5')).toBe(DEFAULT_RERANK_TIMEOUT_MS);

    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('clamps out-of-range values', () => {
    expect(parseRerankTimeoutMs('0')).toBe(RERANK_TIMEOUT_MIN_MS);
    expect(parseRerankTimeoutMs('999')).toBe(RERANK_TIMEOUT_MIN_MS);
    expect(parseRerankTimeoutMs('999999')).toBe(RERANK_TIMEOUT_MAX_MS);
  });
});

describe('resolveRerankTimeoutMs', () => {
  const previous = process.env.MEMORIX_RERANK_TIMEOUT_MS;

  afterEach(() => {
    if (previous === undefined) delete process.env.MEMORIX_RERANK_TIMEOUT_MS;
    else process.env.MEMORIX_RERANK_TIMEOUT_MS = previous;
  });

  it('prefers an explicit positive timeout over the environment', () => {
    process.env.MEMORIX_RERANK_TIMEOUT_MS = '12000';
    expect(resolveRerankTimeoutMs(8_000)).toBe(8_000);
  });

  it('honors MEMORIX_RERANK_TIMEOUT_MS when no explicit timeout is passed', () => {
    process.env.MEMORIX_RERANK_TIMEOUT_MS = '12000';
    expect(resolveRerankTimeoutMs()).toBe(12_000);
  });

  it('defaults to 30s when neither override nor env is set', () => {
    delete process.env.MEMORIX_RERANK_TIMEOUT_MS;
    expect(resolveRerankTimeoutMs()).toBe(DEFAULT_RERANK_TIMEOUT_MS);
  });
});

describe('shouldAttemptHttpRerank', () => {
  it('runs on thorough search with at least 3 candidates', () => {
    expect(shouldAttemptHttpRerank({
      quality: 'thorough',
      hasQuery: true,
      candidateCount: 3,
    })).toBe(true);
  });

  it('does not require a long query or close top-2 scores', () => {
    expect(shouldAttemptHttpRerank({
      quality: 'thorough',
      hasQuery: true,
      candidateCount: 8,
    })).toBe(true);
  });

  it('skips balanced/fast profiles and thin result sets', () => {
    expect(shouldAttemptHttpRerank({
      quality: 'balanced',
      hasQuery: true,
      candidateCount: 8,
    })).toBe(false);
    expect(shouldAttemptHttpRerank({
      quality: 'thorough',
      hasQuery: true,
      candidateCount: 2,
    })).toBe(false);
    expect(shouldAttemptHttpRerank({
      quality: 'thorough',
      hasQuery: false,
      candidateCount: 8,
    })).toBe(false);
  });
});

describe('shouldAttemptLlmRerank', () => {
  const heavyAmbiguous = {
    quality: 'thorough',
    tier: 'heavy',
    hasQuery: true,
    candidateCount: 5,
    topScore: 1,
    secondScore: 0.8,
    httpRerankConfigured: false,
  };

  it('keeps the original thorough + heavy + close top-2 gate when HTTP is off', () => {
    expect(shouldAttemptLlmRerank(heavyAmbiguous)).toBe(true);
  });

  it('does not run when an HTTP rerank lane is configured', () => {
    expect(shouldAttemptLlmRerank({
      ...heavyAmbiguous,
      httpRerankConfigured: true,
    })).toBe(false);
  });

  it('skips standard-tier or decisive top-2 scores', () => {
    expect(shouldAttemptLlmRerank({
      ...heavyAmbiguous,
      tier: 'standard',
    })).toBe(false);
    expect(shouldAttemptLlmRerank({
      ...heavyAmbiguous,
      secondScore: 0.4,
    })).toBe(false);
  });
});
