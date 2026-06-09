/**
 * Token Budget Manager
 *
 * Provides token counting and budget management for Progressive Disclosure.
 * Source: gpt-tokenizer (737 stars, JS port of OpenAI's tiktoken)
 *
 * Used by the Compact Engine to determine which layer of detail
 * fits within the caller's token budget.
 */
/**
 * Count tokens in a string.
 */
export declare function countTextTokens(text: string): number;
/**
 * Check if text fits within a token limit.
 * Returns the token count if within limit, false otherwise.
 */
export declare function fitsInBudget(text: string, limit: number): number | false;
/**
 * Truncate text to fit within a token budget.
 * Truncates at sentence boundaries when possible.
 */
export declare function truncateToTokenBudget(text: string, budget: number): string;
/**
 * Estimate the token cost of an IndexEntry line.
 * Used to predict compact index size.
 */
export declare function estimateIndexEntryTokens(title: string): number;
//# sourceMappingURL=token-budget.d.ts.map