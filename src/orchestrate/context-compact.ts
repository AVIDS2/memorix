/**
 * Context Compaction — Phase 7, Step 6: 4-layer compaction for long pipelines.
 *
 * Prevents context overflow by progressively compacting older content:
 *   Layer 1: Tool Result Micro-Compact — trim old ledger entries to short placeholders
 *   Layer 2: Gate Output Compact — handled by output-budget.ts (trimAndPersist)
 *   Layer 3: Fix Prompt Compaction — summarize previous fix attempts
 *   Layer 4: Pipeline-Level Compaction — compact old tasks in long pipelines
 *
 * Circuit Breaker: if compaction fails, fall back to simple truncation
 * (first 500 + last 500 chars). Never let compaction crash the pipeline.
 */

import { trimToBudget } from './output-budget.js';

// ── Types ──────────────────────────────────────────────────────────

export interface CompactionConfig {
  /** Max number of full ledger entries to keep (older ones get compacted). Default: 5 */
  maxFullEntries: number;
  /** Max total chars for all fix attempt summaries. Default: 2000 */
  fixHistoryBudget: number;
  /** Pipeline task count threshold for pipeline-level compaction. Default: 20 */
  pipelineCompactThreshold: number;
  /** Number of recent tasks to keep in full detail during pipeline compaction. Default: 5 */
  recentTaskWindow: number;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  maxFullEntries: 5,
  fixHistoryBudget: 2000,
  pipelineCompactThreshold: 20,
  recentTaskWindow: 5,
};

export interface LedgerEntry {
  taskId: string;
  role: string;
  agent: string;
  status: 'completed' | 'failed';
  summary: string;
  durationMs: number;
}

export interface FixAttemptRecord {
  attempt: number;
  gate: string;
  errorOutput: string;
  fixOutput: string;
  passed: boolean;
}

// ── Layer 1: Tool Result Micro-Compact ─────────────────────────────

/**
 * Compact old ledger entries: keep only the N most recent in full detail,
 * replace older ones with one-line placeholders.
 *
 * Never throws — returns input unchanged on error.
 */
export function compactLedgerEntries(
  entries: LedgerEntry[],
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
): string {
  try {
    if (entries.length <= config.maxFullEntries) {
      return entries.map(formatFullEntry).join('\n');
    }

    const oldEntries = entries.slice(0, entries.length - config.maxFullEntries);
    const recentEntries = entries.slice(-config.maxFullEntries);

    const compactedOld = oldEntries.map(e => {
      const status = e.status === 'completed' ? '✓' : '✗';
      return `  ${status} ${e.role}/${e.agent}: ${e.summary.slice(0, 60)}`;
    }).join('\n');

    const compactedHeader = `### Earlier tasks (${oldEntries.length} compacted)\n${compactedOld}`;
    const recentSection = `### Recent tasks (${recentEntries.length} full)\n${recentEntries.map(formatFullEntry).join('\n')}`;

    return `${compactedHeader}\n\n${recentSection}`;
  } catch {
    // Circuit breaker: return raw entries on failure
    return entries.map(formatFullEntry).join('\n');
  }
}

// ── Layer 3: Fix Prompt Compaction ─────────────────────────────────

/**
 * Compact fix attempt history for inclusion in the next fix prompt.
 * After the first attempt, summarize previous attempts instead of
 * including full error + fix outputs each time.
 *
 * Never throws — returns simple concatenation on error.
 */
export function compactFixHistory(
  attempts: FixAttemptRecord[],
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
): string {
  try {
    if (attempts.length === 0) return '';

    // First attempt: no history needed
    if (attempts.length === 1) {
      return formatFixAttempt(attempts[0]);
    }

    // Multiple attempts: summarize older, keep latest full
    const older = attempts.slice(0, -1);
    const latest = attempts[attempts.length - 1];

    const olderSummary = older.map((a, i) => {
      const status = a.passed ? 'PASSED' : 'FAILED';
      return `  - Attempt ${i + 1}: ${status} (${a.gate}) — ${a.errorOutput.slice(0, 80)}`;
    }).join('\n');

    let history = `### Previous fix attempts (${older.length} summarized)\n${olderSummary}`;

    // Enforce budget on history section
    if (history.length > config.fixHistoryBudget) {
      history = trimToBudget(history, config.fixHistoryBudget);
    }

    return `${history}\n\n### Latest attempt\n${formatFixAttempt(latest)}`;
  } catch {
    // Circuit breaker: simple concatenation
    return attempts.map(formatFixAttempt).join('\n---\n');
  }
}

// ── Layer 4: Pipeline-Level Compaction ─────────────────────────────

/**
 * Compact an entire pipeline's task list for prompt injection.
 * For long pipelines (>threshold tasks), compact older entries into
 * a summary paragraph, keeping only the recent N tasks in full.
 *
 * Never throws — returns full list on error.
 */
export function compactPipelineContext(
  entries: LedgerEntry[],
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
): string {
  try {
    if (entries.length <= config.pipelineCompactThreshold) {
      return compactLedgerEntries(entries, config);
    }

    const oldEntries = entries.slice(0, entries.length - config.recentTaskWindow);
    const recentEntries = entries.slice(-config.recentTaskWindow);

    // Summary stats for old entries
    const completedCount = oldEntries.filter(e => e.status === 'completed').length;
    const failedCount = oldEntries.filter(e => e.status === 'failed').length;
    const roles = [...new Set(oldEntries.map(e => e.role))];

    const summary = [
      `### Pipeline progress (${entries.length} total tasks)`,
      `${oldEntries.length} earlier tasks: ${completedCount} completed, ${failedCount} failed.`,
      `Roles involved: ${roles.join(', ')}.`,
    ].join('\n');

    const recentSection = `### Recent tasks (${recentEntries.length} full detail)\n${recentEntries.map(formatFullEntry).join('\n')}`;

    return `${summary}\n\n${recentSection}`;
  } catch {
    // Circuit breaker: return full list via basic compaction
    return compactLedgerEntries(entries, config);
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function formatFullEntry(e: LedgerEntry): string {
  const status = e.status === 'completed' ? '✓' : '✗';
  const duration = `${(e.durationMs / 1000).toFixed(1)}s`;
  return `- [${status}] **${e.role}** (${e.agent}, ${duration}): ${e.summary}`;
}

function formatFixAttempt(a: FixAttemptRecord): string {
  const status = a.passed ? 'PASSED' : 'FAILED';
  return [
    `**Attempt ${a.attempt}** [${status}] — ${a.gate} gate`,
    `Error: ${a.errorOutput.slice(0, 300)}`,
    `Fix: ${a.fixOutput.slice(0, 300)}`,
  ].join('\n');
}
