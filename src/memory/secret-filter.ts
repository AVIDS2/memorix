/**
 * Secret Filter
 *
 * Conservative credential detection and redaction for Memorix memory content.
 * Designed for low false-positive risk: only matches explicit credential
 * assignments (key=value / key: value), not generic discussion of auth concepts.
 *
 *   sanitizeCredentials()  — store-time: called inside storeObservation() before write
 *   redactCredentials()    — retrieval-time: called in format/output paths for legacy safety
 *   containsCredential()   — predicate used for testing and optional logging
 *
 * Both sanitize and redact share the same pattern logic. They are kept as
 * separate named exports so call-site semantics remain clear.
 */

/**
 * Replaces the VALUE portion of matched credential patterns with [REDACTED].
 * The credential key name is preserved so context is not lost.
 *
 * Pattern categories:
 *   1. key=value / key: value forms — password, token, api_key, secret, etc.
 *      Requires a real value (6+ non-whitespace chars) to avoid matching
 *      discussion text like "password must be 8 chars".
 *   2. Bearer authorization header tokens (20+ chars)
 *   3. Structured token prefixes: GitHub (ghp_/ghs_/gho_), OpenAI (sk-), JWT (eyJ)
 */
function applyRedaction(text: string): string {
  if (!text) return text;
  let out = text;

  // key=value / key: "value" / key='value' — preserve key, redact value
  out = out.replace(
    /((?:password|passwd|pwd|secret|token|api[_-]?key|auth[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)\s*[:=]\s*["']?)([^\s"',;\n]{6,})/gi,
    '$1[REDACTED]',
  );

  // Bearer <token> — preserve "Bearer ", redact token
  out = out.replace(
    /(Bearer\s+)([A-Za-z0-9._\-/+]{20,})/g,
    '$1[REDACTED]',
  );

  // GitHub tokens (ghp_, ghs_, gho_, github_pat_)
  out = out.replace(/\b(?:ghp|ghs|gho|github_pat)_[A-Za-z0-9]{36,}\b/g, '[REDACTED]');

  // OpenAI / similar keys (sk-...)
  out = out.replace(/\bsk-[A-Za-z0-9T-]{20,}\b/g, '[REDACTED]');

  // JWT tokens (base64url header eyJ...)
  out = out.replace(/\beyJ[A-Za-z0-9._-]{40,}\b/g, '[REDACTED]');

  return out;
}

/**
 * Store-time sanitization: strips credential values before any durable write.
 * Called inside storeObservation() / upsertObservation() so that every write
 * path (hooks, git-ingest, CLI, reasoning, compact-on-write) is covered.
 */
export function sanitizeCredentials(text: string): string {
  return applyRedaction(text);
}

/**
 * Retrieval-time redaction: masks credential values in display output.
 * Applied in all output formatters (detail, index table, timeline, session context)
 * as a safety net for legacy observations stored before sanitization was in place.
 */
export function redactCredentials(text: string): string {
  return applyRedaction(text);
}

/**
 * Returns true if the text contains an obvious credential pattern.
 * Used for testing and optional diagnostic logging.
 */
export function containsCredential(text: string): boolean {
  return applyRedaction(text) !== text;
}
