/**
 * Cost Tracker — Phase 7, Step 8: Token → USD conversion and budget enforcement.
 *
 * Converts accumulated token usage (per model) into USD using a configurable
 * price table. Supports budget limits that abort the pipeline when exceeded.
 *
 * Design principle: if the price table doesn't have a model, report tokens only
 * (skip USD calculation). Never crash because of a missing price entry.
 */

import type { TokenUsage } from './adapters/types.js';

// ── Types ──────────────────────────────────────────────────────────

export interface ModelPrice {
  /** Cost per 1M input tokens in USD */
  inputPer1M: number;
  /** Cost per 1M output tokens in USD */
  outputPer1M: number;
  /** Cost per 1M cache read tokens in USD (default: 0) */
  cacheReadPer1M?: number;
  /** Cost per 1M cache write tokens in USD (default: 0) */
  cacheWritePer1M?: number;
}

export interface CostSummary {
  /** Total cost in USD (null if no price data available) */
  totalUSD: number | null;
  /** Per-model breakdown */
  models: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUSD: number | null;
  }[];
  /** Whether the budget has been exceeded */
  budgetExceeded: boolean;
  /** Configured budget (null if no budget) */
  budgetUSD: number | null;
}

// ── Default Price Table ────────────────────────────────────────────

const DEFAULT_PRICES: Record<string, ModelPrice> = {
  // Claude models — verified 2026-04-13 via Anthropic docs
  'claude-opus-4-6': { inputPer1M: 5, outputPer1M: 25, cacheReadPer1M: 0.50, cacheWritePer1M: 6.25 },
  'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.30, cacheWritePer1M: 3.75 },
  'claude-haiku-4-5': { inputPer1M: 1, outputPer1M: 5, cacheReadPer1M: 0.10, cacheWritePer1M: 1.25 },
  'claude-haiku-4-5-20251001': { inputPer1M: 1, outputPer1M: 5, cacheReadPer1M: 0.10, cacheWritePer1M: 1.25 },
  // Legacy Claude models (still in use by some adapters)
  'claude-sonnet-4-20250514': { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.30, cacheWritePer1M: 3.75 },
  'claude-sonnet-4-0-20250514': { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.30, cacheWritePer1M: 3.75 },
  'claude-opus-4-20250514': { inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.50, cacheWritePer1M: 18.75 },
  'claude-3-5-sonnet': { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.30, cacheWritePer1M: 3.75 },
  'claude-3-5-haiku': { inputPer1M: 0.80, outputPer1M: 4, cacheReadPer1M: 0.08, cacheWritePer1M: 1 },

  // OpenAI / Codex models — verified 2026-04-13
  'gpt-5': { inputPer1M: 1.25, outputPer1M: 10 },
  'gpt-5-mini': { inputPer1M: 0.25, outputPer1M: 2 },
  'gpt-5-nano': { inputPer1M: 0.05, outputPer1M: 0.40 },
  'gpt-5.2': { inputPer1M: 1.75, outputPer1M: 14 },
  'o3': { inputPer1M: 2, outputPer1M: 8 },
  'o3-mini': { inputPer1M: 1.10, outputPer1M: 4.40 },
  'o4-mini': { inputPer1M: 1.10, outputPer1M: 4.40 },
  'gpt-4.1': { inputPer1M: 2, outputPer1M: 8, cacheReadPer1M: 0.50, cacheWritePer1M: 2 },
  'gpt-4.1-mini': { inputPer1M: 0.40, outputPer1M: 1.60, cacheReadPer1M: 0.10, cacheWritePer1M: 0.40 },
  'gpt-4.1-nano': { inputPer1M: 0.10, outputPer1M: 0.40 },
  'gpt-4o': { inputPer1M: 2.50, outputPer1M: 10, cacheReadPer1M: 1.25 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60, cacheReadPer1M: 0.075 },

  // Google Gemini models — verified 2026-04-13 via Google AI pricing
  'gemini-2.5-flash': { inputPer1M: 0.30, outputPer1M: 2.50 },
  'gemini-2.5-flash-preview-05-20': { inputPer1M: 0.30, outputPer1M: 2.50 },
  'gemini-2.5-flash-lite': { inputPer1M: 0.10, outputPer1M: 0.40 },
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10 },
  'gemini-2.0-flash': { inputPer1M: 0.10, outputPer1M: 0.40 },
  'gemini-2.0-flash-lite': { inputPer1M: 0.075, outputPer1M: 0.30 },
  // Gemini 3.x generation
  'gemini-3.1-pro': { inputPer1M: 2, outputPer1M: 12 },
  'gemini-3-flash': { inputPer1M: 0.50, outputPer1M: 3 },

  // OpenCode / open models — verified 2026-04-13
  'deepseek-coder': { inputPer1M: 0.28, outputPer1M: 0.42 },
  'deepseek-chat': { inputPer1M: 0.28, outputPer1M: 0.42 },
};

// ── Core ───────────────────────────────────────────────────────────

/**
 * Calculate cost for a single model's token usage.
 * Returns null if the model is not in the price table.
 */
export function calculateModelCost(
  model: string,
  usage: TokenUsage,
  customPrices?: Record<string, ModelPrice>,
): number | null {
  const prices = { ...DEFAULT_PRICES, ...customPrices };
  const price = findPrice(model, prices);
  if (!price) return null;

  const inputCost = (usage.inputTokens / 1_000_000) * price.inputPer1M;
  const outputCost = (usage.outputTokens / 1_000_000) * price.outputPer1M;
  const cacheReadCost = (usage.cacheReadTokens / 1_000_000) * (price.cacheReadPer1M ?? 0);
  const cacheWriteCost = (usage.cacheWriteTokens / 1_000_000) * (price.cacheWritePer1M ?? 0);

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

/**
 * Calculate total pipeline cost from accumulated token usage.
 */
export function calculatePipelineCost(
  tokenUsage: Record<string, TokenUsage>,
  budgetUSD?: number,
  customPrices?: Record<string, ModelPrice>,
): CostSummary {
  const models: CostSummary['models'] = [];
  let totalUSD: number | null = 0;
  let hasAnyPrice = false;

  for (const [model, usage] of Object.entries(tokenUsage)) {
    const cost = calculateModelCost(model, usage, customPrices);
    if (cost !== null) {
      hasAnyPrice = true;
      totalUSD = (totalUSD ?? 0) + cost;
    }

    models.push({
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      costUSD: cost !== null ? Math.round(cost * 10000) / 10000 : null, // Round to 4 decimals
    });
  }

  if (!hasAnyPrice) totalUSD = null;
  else totalUSD = Math.round(totalUSD! * 10000) / 10000;

  return {
    totalUSD,
    models,
    budgetExceeded: budgetUSD != null && totalUSD != null && totalUSD > budgetUSD,
    budgetUSD: budgetUSD ?? null,
  };
}

/**
 * Check if the current cost exceeds the budget.
 * Returns false if no budget is set or cost cannot be calculated.
 */
export function isBudgetExceeded(
  tokenUsage: Record<string, TokenUsage>,
  budgetUSD?: number,
  customPrices?: Record<string, ModelPrice>,
): boolean {
  if (budgetUSD == null) return false;
  const summary = calculatePipelineCost(tokenUsage, budgetUSD, customPrices);
  return summary.budgetExceeded;
}

/**
 * Format cost summary for CLI display.
 */
export function formatCostSummary(summary: CostSummary): string {
  const lines: string[] = [];

  for (const m of summary.models) {
    const tokens = `in=${fmtNum(m.inputTokens)} out=${fmtNum(m.outputTokens)}`;
    const cache = m.cacheReadTokens > 0 || m.cacheWriteTokens > 0
      ? ` cache_r=${fmtNum(m.cacheReadTokens)} cache_w=${fmtNum(m.cacheWriteTokens)}`
      : '';
    const cost = m.costUSD !== null ? ` ($${m.costUSD.toFixed(4)})` : '';
    lines.push(`  ${m.model}: ${tokens}${cache}${cost}`);
  }

  if (summary.totalUSD !== null) {
    lines.push(`  Total: $${summary.totalUSD.toFixed(4)}`);
  }

  if (summary.budgetUSD !== null) {
    const status = summary.budgetExceeded ? ' ⚠ EXCEEDED' : '';
    lines.push(`  Budget: $${summary.budgetUSD.toFixed(2)}${status}`);
  }

  return lines.join('\n');
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Find price entry by model name. Supports fuzzy matching:
 * "claude-sonnet-4-20250514" matches "claude-sonnet-4-20250514" exactly,
 * but also tries prefix matching for versioned models.
 */
function findPrice(model: string, prices: Record<string, ModelPrice>): ModelPrice | null {
  // Exact match
  if (prices[model]) return prices[model];

  // Prefix match: "claude-sonnet-4-20250514" → try "claude-sonnet-4"
  const normalized = model.toLowerCase();
  for (const [key, price] of Object.entries(prices)) {
    if (normalized.startsWith(key.toLowerCase()) || key.toLowerCase().startsWith(normalized)) {
      return price;
    }
  }

  return null;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
