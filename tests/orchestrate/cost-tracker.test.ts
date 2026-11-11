import { describe, it, expect } from 'vitest';
import { calculateModelCost, calculatePipelineCost, isBudgetExceeded, formatCostSummary } from '../../src/orchestrate/cost-tracker.js';
import type { TokenUsage } from '../../src/orchestrate/adapters/types.js';

const makeUsage = (input: number, output: number, cacheRead = 0, cacheWrite = 0): TokenUsage => ({
  inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite,
});

describe('calculateModelCost', () => {
  it('should calculate cost for known Claude model', () => {
    const cost = calculateModelCost('claude-sonnet-4-20250514', makeUsage(100_000, 1_000, 50_000));
    expect(cost).not.toBeNull();
    expect(cost!).toBeGreaterThan(0);
    // 100k * 3/1M + 1k * 15/1M + 50k * 0.30/1M = 0.3 + 0.015 + 0.015 = 0.33
    expect(cost!).toBeCloseTo(0.33, 2);
  });

  it('should return null for unknown model', () => {
    const cost = calculateModelCost('unknown-model-xyz', makeUsage(100_000, 1_000));
    expect(cost).toBeNull();
  });

  it('should support custom price overrides', () => {
    const cost = calculateModelCost('my-model', makeUsage(1_000_000, 0), {
      'my-model': { inputPer1M: 10, outputPer1M: 20 },
    });
    expect(cost).toBe(10);
  });
});

describe('calculatePipelineCost', () => {
  it('should aggregate costs across models', () => {
    const usage: Record<string, TokenUsage> = {
      'claude-sonnet-4-20250514': makeUsage(100_000, 1_000),
      'gpt-4o': makeUsage(50_000, 500),
    };
    const summary = calculatePipelineCost(usage);
    expect(summary.totalUSD).not.toBeNull();
    expect(summary.totalUSD!).toBeGreaterThan(0);
    expect(summary.models).toHaveLength(2);
  });

  it('should mark budget exceeded', () => {
    const usage: Record<string, TokenUsage> = {
      'claude-sonnet-4-20250514': makeUsage(10_000_000, 100_000), // ~$31.5
    };
    const summary = calculatePipelineCost(usage, 1.0); // $1 budget
    expect(summary.budgetExceeded).toBe(true);
  });

  it('should not mark budget exceeded when under', () => {
    const usage: Record<string, TokenUsage> = {
      'claude-sonnet-4-20250514': makeUsage(1_000, 100),
    };
    const summary = calculatePipelineCost(usage, 100);
    expect(summary.budgetExceeded).toBe(false);
  });
});

describe('isBudgetExceeded', () => {
  it('should return false when no budget set', () => {
    expect(isBudgetExceeded({ 'claude-sonnet-4-20250514': makeUsage(10_000_000, 100_000) })).toBe(false);
  });
});

describe('formatCostSummary', () => {
  it('should format summary with cost info', () => {
    const summary = calculatePipelineCost(
      { 'claude-sonnet-4-20250514': makeUsage(100_000, 1_000) },
      10,
    );
    const formatted = formatCostSummary(summary);
    expect(formatted).toContain('claude-sonnet');
    expect(formatted).toContain('$');
    expect(formatted).toContain('Budget');
  });
});
