/**
 * Token Budget Tests
 *
 * TDD: Tests token counting, budget checking, and truncation.
 */

import { describe, it, expect } from 'vitest';
import {
  countTextTokens,
  fitsInBudget,
  truncateToTokenBudget,
  estimateIndexEntryTokens,
} from '../../src/compact/token-budget.js';

describe('Token Budget', () => {
  describe('countTextTokens', () => {
    it('should return positive count for non-empty text', () => {
      const tokens = countTextTokens('Hello world');
      expect(tokens).toBeGreaterThan(0);
    });

    it('should return 0 for empty string', () => {
      const tokens = countTextTokens('');
      expect(tokens).toBe(0);
    });

    it('should count more tokens for longer text', () => {
      const short = countTextTokens('Hi');
      const long = countTextTokens('This is a much longer sentence with many words in it');
      expect(long).toBeGreaterThan(short);
    });
  });

  describe('fitsInBudget', () => {
    it('should return token count when within budget', () => {
      const result = fitsInBudget('Hello', 100);
      expect(result).not.toBe(false);
      expect(typeof result).toBe('number');
    });

    it('should return false when exceeding budget', () => {
      const result = fitsInBudget('A'.repeat(10000), 5);
      expect(result).toBe(false);
    });
  });

  describe('truncateToTokenBudget', () => {
    it('should return text unchanged when within budget', () => {
      const text = 'Short text';
      const result = truncateToTokenBudget(text, 100);
      expect(result).toBe(text);
    });

    it('should truncate text that exceeds budget', () => {
      const longText = Array(100).fill('This is a sentence.').join(' ');
      const result = truncateToTokenBudget(longText, 20);
      expect(result.length).toBeLessThan(longText.length);
    });

    it('should produce text within the budget', () => {
      const longText = Array(100).fill('This is a sentence.').join(' ');
      const budget = 30;
      const result = truncateToTokenBudget(longText, budget);
      const tokens = countTextTokens(result);
      // Allow some slack for the "..." suffix
      expect(tokens).toBeLessThanOrEqual(budget + 5);
    });

    it('does not leave a partial technical identifier at the truncation boundary', () => {
      const text = 'Keep JWT refresh behind AUTH_REFRESH_V2 until the focused migration test passes.';
      const result = truncateToTokenBudget(text, 14);

      expect(result).not.toContain('AUTH...');
      expect(result).not.toContain('AUTH_...');
      expect(result).toMatch(/\.\.\.$/);
    });
  });

  describe('estimateIndexEntryTokens', () => {
    it('should return positive estimate', () => {
      const est = estimateIndexEntryTokens('Port 3001 conflict fix');
      expect(est).toBeGreaterThan(0);
    });

    it('should include overhead', () => {
      const titleOnly = countTextTokens('Fix');
      const withOverhead = estimateIndexEntryTokens('Fix');
      expect(withOverhead).toBeGreaterThan(titleOnly);
    });
  });
});
