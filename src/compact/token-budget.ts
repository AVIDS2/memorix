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
export function countTextTokens(text: string): number {
  return countTokens(text);
}

/**
 * Check if text fits within a token limit.
 * Returns the token count if within limit, false otherwise.
 */
export function fitsInBudget(text: string, limit: number): number | false {
  return isWithinTokenLimit(text, limit);
}

/**
 * Truncate text to fit within a token budget.
 * Truncates at sentence boundaries when possible.
 */
export function truncateToTokenBudget(text: string, budget: number): string {
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
      // A character estimate can end halfway through a flag, path, or symbol.
      // Drop the incomplete whitespace-delimited token instead of returning
      // misleading fragments such as `AUTH...`.
      const nextCharacter = text.charAt(result.length);
      if (nextCharacter && !/[\s.,;:!?)}\]]/.test(nextCharacter)) {
        const boundary = result.search(/\s+\S*$/);
        result = boundary > 0 ? result.slice(0, boundary).trimEnd() : '';
      }

      // Keep the suffix inside the stated budget when there is room. An empty
      // prefix is more honest than a partial identifier that appears valid.
      while (result && fitsInBudget(result + '...', budget) === false) {
        const boundary = result.lastIndexOf(' ');
        result = boundary > 0 ? result.slice(0, boundary).trimEnd() : '';
      }
      result = result ? result + '...' : '...';
    }
  }

  return result;
}

/**
 * Estimate the token cost of an IndexEntry line.
 * Used to predict compact index size.
 */
export function estimateIndexEntryTokens(title: string): number {
  // Format: "| #ID | Time | Icon | Title | ~Tokens |"
  // Overhead is roughly 15 tokens for formatting
  return countTextTokens(title) + 15;
}
