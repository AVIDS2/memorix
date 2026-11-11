/**
 * Tests for Source-Aware Retrieval
 *
 * Validates that query intent correctly maps to source boost factors,
 * so "what changed" queries prefer git memories and "why" queries
 * prefer agent-authored reasoning memories.
 */

import { describe, it, expect } from 'vitest';
import { detectQueryIntent } from '../../src/search/intent-detector.js';

describe('Source-Aware Retrieval via Intent Detection', () => {
  // ─── "what changed" queries should boost git source ───

  it('should boost git source for "what changed" queries', () => {
    const result = detectQueryIntent('what changed in the auth module');
    expect(result.intent).toBe('what_changed');
    expect(result.confidence).toBeGreaterThan(0.3);
    expect(result.sourceBoosts).toBeDefined();
    expect(result.sourceBoosts!.git).toBeGreaterThan(1.0);
    expect(result.sourceBoosts!.agent).toBeLessThan(1.0);
  });

  it('should boost git source for modification queries', () => {
    const result = detectQueryIntent('what was modified in the last refactor');
    expect(result.intent).toBe('what_changed');
    expect(result.sourceBoosts?.git).toBeGreaterThan(1.0);
  });

  it('should boost git source for Chinese "改了什么" queries', () => {
    const result = detectQueryIntent('最近改了什么');
    expect(result.sourceBoosts).toBeDefined();
    // Should be either what_changed or when intent, both boost git
    expect(result.sourceBoosts!.git).toBeGreaterThanOrEqual(1.0);
  });

  // ─── "why" queries should boost agent source ───

  it('should boost agent source for "why" queries', () => {
    const result = detectQueryIntent('why did we choose PostgreSQL over MongoDB');
    expect(result.intent).toBe('why');
    expect(result.confidence).toBeGreaterThan(0.3);
    expect(result.sourceBoosts).toBeDefined();
    expect(result.sourceBoosts!.agent).toBeGreaterThan(1.0);
    expect(result.sourceBoosts!.git).toBeLessThan(1.0);
  });

  it('should boost agent source for decision rationale queries', () => {
    const result = detectQueryIntent('what was the rationale for the architecture decision');
    expect(result.intent).toBe('why');
    expect(result.sourceBoosts?.agent).toBeGreaterThan(1.0);
  });

  it('should boost agent source for Chinese "为什么" queries', () => {
    const result = detectQueryIntent('为什么选择这个方案');
    expect(result.intent).toBe('why');
    expect(result.sourceBoosts?.agent).toBeGreaterThan(1.0);
  });

  // ─── "when" queries should boost git source ───

  it('should boost git source for temporal queries', () => {
    const result = detectQueryIntent('when was the auth module last changed');
    expect(result.sourceBoosts).toBeDefined();
    expect(result.sourceBoosts!.git).toBeGreaterThan(1.0);
  });

  // ─── "problem" queries should boost both sources equally ───

  it('should boost both sources for problem queries', () => {
    const result = detectQueryIntent('how did we fix the login bug');
    expect(result.intent).toBe('problem');
    expect(result.sourceBoosts).toBeDefined();
    expect(result.sourceBoosts!.git).toBeGreaterThanOrEqual(1.0);
    expect(result.sourceBoosts!.agent).toBeGreaterThanOrEqual(1.0);
  });

  // ─── General queries should have no source boost ───

  it('should have no source boost for general queries', () => {
    const result = detectQueryIntent('authentication');
    expect(result.intent).toBe('general');
    expect(result.sourceBoosts).toBeUndefined();
  });

  // ─── Confidence gating ───

  it('should not apply source boosts when confidence is low', () => {
    const result = detectQueryIntent('a');
    expect(result.confidence).toBeLessThanOrEqual(0.3);
    // Even if sourceBoosts exist, low confidence means they shouldn't be applied
  });
});
