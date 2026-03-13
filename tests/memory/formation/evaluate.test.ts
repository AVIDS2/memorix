import { describe, it, expect } from 'vitest';
import { runEvaluate } from '../../../src/memory/formation/evaluate.js';
import type { ExtractResult } from '../../../src/memory/formation/types.js';

function makeExtract(overrides: Partial<ExtractResult> = {}): ExtractResult {
  return {
    title: 'Test observation',
    titleImproved: false,
    narrative: 'This is a test narrative.',
    facts: [],
    extractedFacts: [],
    entityName: 'test-module',
    entityResolved: false,
    type: 'discovery',
    typeCorrected: false,
    ...overrides,
  };
}

describe('Formation Stage 3: Evaluate', () => {
  describe('Type-based scoring', () => {
    it('should score gotchas higher than what-changed', () => {
      const gotcha = runEvaluate(makeExtract({ type: 'gotcha', narrative: 'Important pitfall with auth tokens.' }));
      const changed = runEvaluate(makeExtract({ type: 'what-changed', narrative: 'Important pitfall with auth tokens.' }));
      expect(gotcha.score).toBeGreaterThan(changed.score);
    });

    it('should score decisions as core', () => {
      const result = runEvaluate(makeExtract({
        type: 'decision',
        narrative: 'Chose PostgreSQL over MySQL because of better JSON support and JSONB indexing.',
        facts: ['Database: PostgreSQL', 'Reason: JSONB indexing'],
      }));
      expect(result.score).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('Fact density', () => {
    it('should boost score for fact-dense observations', () => {
      const withFacts = runEvaluate(makeExtract({
        narrative: 'Auth configuration details.',
        facts: ['JWT TTL: 15m', 'Refresh TTL: 7d', 'Algorithm: RS256', 'Issuer: auth.example.com'],
      }));
      const withoutFacts = runEvaluate(makeExtract({
        narrative: 'Auth configuration details.',
        facts: [],
      }));
      expect(withFacts.score).toBeGreaterThan(withoutFacts.score);
    });
  });

  describe('Specificity', () => {
    it('should boost score for content with version numbers and error codes', () => {
      const specific = runEvaluate(makeExtract({
        narrative: 'Fixed ECONNREFUSED on port 5432 after upgrading to v2.1.0. Timeout was 30s.',
        facts: ['Error: ECONNREFUSED', 'Port: 5432'],
      }));
      const vague = runEvaluate(makeExtract({
        narrative: 'Fixed a connection issue after upgrading. Timeout was too long.',
        facts: [],
      }));
      expect(specific.score).toBeGreaterThan(vague.score);
    });
  });

  describe('Causal reasoning', () => {
    it('should boost score for content with causal language', () => {
      const causal = runEvaluate(makeExtract({
        narrative: 'The crash was caused by a race condition because the mutex was not acquired before writing.',
      }));
      const noCausal = runEvaluate(makeExtract({
        narrative: 'The application crashed. The mutex was missing.',
      }));
      expect(causal.score).toBeGreaterThan(noCausal.score);
    });
  });

  describe('Noise detection', () => {
    it('should penalize generic titles', () => {
      const noisy = runEvaluate(makeExtract({
        title: 'Updated config.ts',
        narrative: 'File written successfully.',
      }));
      const clean = runEvaluate(makeExtract({
        title: 'JWT refresh causes silent auth failure',
        narrative: 'The refresh token mechanism silently fails after 24 hours due to missing auto-renewal.',
      }));
      expect(noisy.score).toBeLessThan(clean.score);
    });

    it('should penalize tool output content', () => {
      const toolOutput = runEvaluate(makeExtract({
        narrative: 'File created successfully.\nnpm WARN deprecated package\nSuccessfully installed 3 packages',
      }));
      expect(toolOutput.score).toBeLessThan(0.5);
    });
  });

  describe('Value categories', () => {
    it('should classify high-value as core', () => {
      const result = runEvaluate(makeExtract({
        type: 'gotcha',
        narrative: 'Critical: the Docker container crashes because of OOM when processing files larger than 2GB. Fixed by setting --memory=4g.',
        facts: ['Memory limit: 4GB', 'File size threshold: 2GB'],
        extractedFacts: ['Memory limit: 4GB'],
      }));
      expect(result.category).toBe('core');
    });

    it('should classify low-value as ephemeral', () => {
      const result = runEvaluate(makeExtract({
        type: 'what-changed',
        title: 'Updated readme.md',
        narrative: 'Minor typo fix.',
        facts: [],
      }));
      expect(result.category).toBe('ephemeral');
    });
  });

  describe('Formation metadata bonuses', () => {
    it('should give small bonus when system extracted facts', () => {
      const withExtracted = runEvaluate(makeExtract({
        extractedFacts: ['Port: 3000', 'Timeout: 60s'],
      }));
      const withoutExtracted = runEvaluate(makeExtract({
        extractedFacts: [],
      }));
      expect(withExtracted.score).toBeGreaterThanOrEqual(withoutExtracted.score);
    });
  });

  describe('Reason string', () => {
    it('should produce a non-empty reason', () => {
      const result = runEvaluate(makeExtract());
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.reason).toContain(result.category);
    });
  });
});
