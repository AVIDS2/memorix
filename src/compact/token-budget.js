/**
 * Token Budget Manager
 *
 * Provides token counting and budget management for Progressive Disclosure.
 * Source: gpt-tokenizer (737 stars, JS port of OpenAI's tiktoken)
 *
 * Used by the Compact Engine to determine which layer of detail
 * fits within the caller's token budget.
 */
import { countTokens, isWithinTokenLimit } from 'gpt-tokenizer';
/**
 * Count tokens in a string.
 */
export function countTextTokens(text) {
    return countTokens(text);
}
/**
 * Check if text fits within a token limit.
 * Returns the token count if within limit, false otherwise.
 */
export function fitsInBudget(text, limit) {
    return isWithinTokenLimit(text, limit);
}
/**
 * Truncate text to fit within a token budget.
 * Truncates at sentence boundaries when possible.
 */
export function truncateToTokenBudget(text, budget) {
    if (fitsInBudget(text, budget) !== false) {
        return text;
    }
    // Binary search for the right length
    const sentences = text.split(/(?<=[.!?])\s+/);
    let result = '';
    for (const sentence of sentences) {
        const candidate = result ? `${result} ${sentence}` : sentence;
        if (fitsInBudget(candidate, budget) === false) {
            break;
        }
        result = candidate;
    }
    // If no complete sentence fits, truncate by characters
    if (!result) {
        // Rough estimate: 1 token ≈ 4 chars for English, ≈ 1.5 chars for Chinese
        const estimatedChars = budget * 2;
        result = text.slice(0, estimatedChars);
        // Refine
        while (fitsInBudget(result, budget) === false && result.length > 0) {
            result = result.slice(0, Math.floor(result.length * 0.9));
        }
        if (result.length < text.length) {
            result += '...';
        }
    }
    return result;
}
/**
 * Estimate the token cost of an IndexEntry line.
 * Used to predict compact index size.
 */
export function estimateIndexEntryTokens(title) {
    // Format: "| #ID | Time | Icon | Title | ~Tokens |"
    // Overhead is roughly 15 tokens for formatting
    return countTextTokens(title) + 15;
}
//# sourceMappingURL=token-budget.js.map