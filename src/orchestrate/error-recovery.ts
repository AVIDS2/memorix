/**
 * Error Recovery — Phase 7, Step 3: Layered error classification and recovery.
 *
 * Detects three failure modes from agent output/exit and recommends a
 * recovery strategy. The coordinator uses this to decide between:
 *   - continuation (truncated output)
 *   - context compaction + re-dispatch (context overflow)
 *   - exponential backoff + retry (transient errors)
 *   - normal retry (unknown / unrecoverable)
 *
 * Design principle: detection is heuristic-based pattern matching on
 * stderr/tailOutput. No false positive should crash the pipeline —
 * the worst case of a wrong classification is a wasted retry attempt.
 */

// ── Types ──────────────────────────────────────────────────────────

export type ErrorCategory = 'truncated' | 'context_overflow' | 'transient' | 'unknown';

export interface RecoveryAction {
  category: ErrorCategory;
  /** Recommended recovery strategy */
  strategy: 'continue' | 'compact_and_retry' | 'backoff_and_retry' | 'normal_retry';
  /** Suggested delay before retry in ms (0 = immediate) */
  delayMs: number;
  /** Human-readable explanation of the detection */
  reason: string;
  /** Suggested continuation prompt (for 'continue' strategy) */
  continuationPrompt?: string;
  /** Backoff attempt number (for 'backoff_and_retry') */
  backoffAttempt?: number;
}

export interface ErrorContext {
  exitCode: number | null;
  killed: boolean;
  tailOutput: string;
  /** Whether the agent stream had an end_turn signal */
  hasEndTurn?: boolean;
}

// ── Pattern Registry ───────────────────────────────────────────────

const TRUNCATED_PATTERNS = [
  /max.?output/i,
  /output.?limit/i,
  /max.?tokens/i,
  /response.?truncat/i,
  /generation.?limit/i,
];

const CONTEXT_OVERFLOW_PATTERNS = [
  /overlong.?prompt/i,
  /context.?length.?exceed/i,
  /prompt.?too.?long/i,
  /maximum.?context/i,
  /token.?limit.?exceed/i,
  /input.?too.?long/i,
  /request.?too.?large/i,
  /max.?input.?tokens/i,
  /content.?too.?long/i,
  /exceeds.?(?:the\s+)?(?:model'?s?\s+)?(?:maximum|max).?(?:context|token)/i,
];

const TRANSIENT_PATTERNS = [
  /rate.?limit/i,
  /429/,
  /too.?many.?requests/i,
  /server.?error/i,
  /502|503|504/,
  /bad.?gateway/i,
  /service.?unavailable/i,
  /gateway.?timeout/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /socket.?hang.?up/i,
  /network.?error/i,
  /temporary.?failure/i,
  /overloaded/i,
  /capacity/i,
];

// ── Backoff State ──────────────────────────────────────────────────

const backoffState = new Map<string, number>(); // taskId → consecutive transient failures

/** Reset backoff state for a task (call on success or non-transient failure) */
export function resetBackoff(taskId: string): void {
  backoffState.delete(taskId);
}

/** Get current backoff attempt count for a task */
export function getBackoffAttempt(taskId: string): number {
  return backoffState.get(taskId) ?? 0;
}

// ── Core Classification ────────────────────────────────────────────

/**
 * Classify an agent failure and recommend a recovery action.
 *
 * Priority order: truncated > context_overflow > transient > unknown.
 * This ensures the most specific recovery strategy is chosen.
 */
export function classifyError(ctx: ErrorContext, taskId?: string): RecoveryAction {
  const { exitCode, killed, tailOutput, hasEndTurn } = ctx;
  const text = tailOutput.slice(-2000); // Only check last 2KB

  // 1. Truncated output detection
  // Agent was cut off mid-response (no end_turn + non-zero exit)
  if (!killed && exitCode !== 0 && hasEndTurn === false) {
    return {
      category: 'truncated',
      strategy: 'continue',
      delayMs: 0,
      reason: 'Agent output appears truncated (no end_turn signal with non-zero exit)',
      continuationPrompt: 'Your previous output was truncated due to output limits. Continue from where you stopped. Do not repeat what you already wrote.',
    };
  }

  // Also detect explicit truncation error messages
  if (matchesAny(text, TRUNCATED_PATTERNS)) {
    return {
      category: 'truncated',
      strategy: 'continue',
      delayMs: 0,
      reason: `Truncation pattern detected in output`,
      continuationPrompt: 'Your previous output was truncated due to output limits. Continue from where you stopped. Do not repeat what you already wrote.',
    };
  }

  // 2. Context overflow detection
  if (matchesAny(text, CONTEXT_OVERFLOW_PATTERNS)) {
    return {
      category: 'context_overflow',
      strategy: 'compact_and_retry',
      delayMs: 0,
      reason: 'Context overflow detected — prompt is too large for the model',
    };
  }

  // 3. Transient error detection
  if (matchesAny(text, TRANSIENT_PATTERNS)) {
    const attempt = taskId ? (backoffState.get(taskId) ?? 0) + 1 : 1;
    if (taskId) backoffState.set(taskId, attempt);

    // Exponential backoff: 2s, 4s, 8s, capped at 30s
    const baseDelay = 2000;
    const maxDelay = 30_000;
    const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
    // Add jitter: ±25%
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);

    return {
      category: 'transient',
      strategy: 'backoff_and_retry',
      delayMs: Math.round(delay + jitter),
      reason: `Transient error detected (attempt ${attempt})`,
      backoffAttempt: attempt,
    };
  }

  // 4. Unknown — fall back to normal retry
  if (taskId) resetBackoff(taskId); // Non-transient failure resets backoff

  return {
    category: 'unknown',
    strategy: 'normal_retry',
    delayMs: 0,
    reason: killed
      ? 'Agent killed by timeout'
      : `Agent exited with code ${exitCode}`,
  };
}

/**
 * Check if the error is recoverable (not a permanent failure).
 * Truncated and transient errors are always recoverable.
 * Context overflow is recoverable if compaction is available.
 * Unknown errors may be recoverable via normal retry.
 */
export function isRecoverable(action: RecoveryAction): boolean {
  return action.strategy !== 'normal_retry' || action.category === 'unknown';
}

// ── Helpers ────────────────────────────────────────────────────────

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(text));
}
