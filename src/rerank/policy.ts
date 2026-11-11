/**
 * Product rules for optional HTTP rerank and the existing LLM rerank path.
 *
 * HTTP rerank is opt-in. When it is configured, thorough search with enough
 * candidates uses the HTTP lane only — a miss or timeout keeps the original
 * order instead of falling through to LLM rerank.
 */

export const DEFAULT_RERANK_TIMEOUT_MS = 30_000;
export const RERANK_TIMEOUT_MIN_MS = 1_000;
export const RERANK_TIMEOUT_MAX_MS = 300_000;
export const MIN_RERANK_CANDIDATES = 3;

/**
 * Parse and validate MEMORIX_RERANK_TIMEOUT_MS.
 *
 * @param raw - Environment value, or undefined when unset
 * @returns Timeout in milliseconds (default 30000)
 */
export function parseRerankTimeoutMs(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_RERANK_TIMEOUT_MS;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || Number.isNaN(parsed)) {
    console.warn(
      `[memorix] MEMORIX_RERANK_TIMEOUT_MS="${raw}" is invalid (must be a positive integer between ${RERANK_TIMEOUT_MIN_MS}-${RERANK_TIMEOUT_MAX_MS}ms). Using default ${DEFAULT_RERANK_TIMEOUT_MS}ms.`,
    );
    return DEFAULT_RERANK_TIMEOUT_MS;
  }

  if (parsed < RERANK_TIMEOUT_MIN_MS) return RERANK_TIMEOUT_MIN_MS;
  if (parsed > RERANK_TIMEOUT_MAX_MS) return RERANK_TIMEOUT_MAX_MS;
  return parsed;
}

/**
 * Resolve the rerank timeout from an explicit override or the environment.
 *
 * @param explicitTimeoutMs - Caller-supplied timeout, when present
 * @returns Timeout in milliseconds
 */
export function resolveRerankTimeoutMs(explicitTimeoutMs?: number): number {
  if (typeof explicitTimeoutMs === 'number' && Number.isFinite(explicitTimeoutMs) && explicitTimeoutMs > 0) {
    return explicitTimeoutMs;
  }
  return parseRerankTimeoutMs(process.env.MEMORIX_RERANK_TIMEOUT_MS);
}

/**
 * True when thorough search has enough candidates for HTTP rerank.
 *
 * @param input - Retrieval quality, query presence, and hit count
 * @returns Whether the HTTP rerank lane should run
 */
export function shouldAttemptHttpRerank(input: {
  quality?: string;
  hasQuery: boolean;
  candidateCount: number;
}): boolean {
  return input.quality === 'thorough'
    && input.hasQuery
    && input.candidateCount >= MIN_RERANK_CANDIDATES;
}

/**
 * True when the existing LLM rerank path should run.
 *
 * LLM rerank stays on the original thorough + heavy + close top-2 gate.
 * It never runs when an HTTP rerank lane is configured.
 *
 * @param input - Search gate inputs plus whether HTTP rerank is configured
 * @returns Whether LLM rerank should run
 */
export function shouldAttemptLlmRerank(input: {
  quality?: string;
  tier: string;
  hasQuery: boolean;
  candidateCount: number;
  topScore: number;
  secondScore: number;
  httpRerankConfigured: boolean;
}): boolean {
  if (input.httpRerankConfigured) return false;
  if (input.quality !== 'thorough' || input.tier !== 'heavy' || !input.hasQuery) return false;
  if (input.candidateCount < MIN_RERANK_CANDIDATES) return false;
  return input.topScore > 0 && input.secondScore / input.topScore > 0.7;
}
