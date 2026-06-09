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
 * Store-time sanitization: strips credential values before any durable write.
 * Called inside storeObservation() / upsertObservation() so that every write
 * path (hooks, git-ingest, CLI, reasoning, compact-on-write) is covered.
 */
export declare function sanitizeCredentials(text: string): string;
/**
 * Retrieval-time redaction: masks credential values in display output.
 * Applied in all output formatters (detail, index table, timeline, session context)
 * as a safety net for legacy observations stored before sanitization was in place.
 */
export declare function redactCredentials(text: string): string;
/**
 * Returns true if the text contains an obvious credential pattern.
 * Used for testing and optional diagnostic logging.
 */
export declare function containsCredential(text: string): boolean;
//# sourceMappingURL=secret-filter.d.ts.map