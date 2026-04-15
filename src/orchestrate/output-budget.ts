/**
 * Output Budget — Phase 7, Step 4: Trim large outputs to a token-friendly size.
 *
 * When gate outputs, agent tail outputs, or other large strings need to be
 * embedded in prompts (e.g., fix prompts, ledger entries), this module trims
 * them to a configurable budget while preserving the most useful parts
 * (beginning + end).
 *
 * Full output is optionally persisted to disk for debugging.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ── Constants ──────────────────────────────────────────────────────

/** Default output budget in bytes */
export const DEFAULT_OUTPUT_BUDGET = 4096;

// ── Core ───────────────────────────────────────────────────────────

/**
 * Trim text to a byte budget. If the text exceeds the budget, keep
 * the first half and last half with an omission marker in between.
 *
 * Returns the trimmed text. Never throws.
 */
export function trimToBudget(text: string, budget: number = DEFAULT_OUTPUT_BUDGET): string {
  if (text.length <= budget) return text;

  const half = Math.floor(budget / 2) - 40; // Reserve space for marker
  if (half <= 0) return text.slice(0, budget);

  const omitted = text.length - half * 2;
  return (
    text.slice(0, half) +
    `\n\n... (${omitted} bytes omitted — full output saved to disk) ...\n\n` +
    text.slice(-half)
  );
}

/**
 * Persist full output to a file and return the trimmed version.
 *
 * If disk write fails, returns the trimmed text without file reference.
 * Never throws.
 */
export function trimAndPersist(
  text: string,
  filePath: string,
  budget: number = DEFAULT_OUTPUT_BUDGET,
): { trimmed: string; persisted: boolean; fullPath?: string } {
  if (text.length <= budget) {
    return { trimmed: text, persisted: false };
  }

  // Persist full output to disk (best-effort)
  let persisted = false;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, text, 'utf-8');
    persisted = true;
  } catch {
    // Disk write failed — degrade gracefully
  }

  const half = Math.floor(budget / 2) - 60; // Reserve space for marker + path
  if (half <= 0) {
    return { trimmed: text.slice(0, budget), persisted, fullPath: persisted ? filePath : undefined };
  }

  const omitted = text.length - half * 2;
  const pathNote = persisted ? ` Full output at: ${filePath}` : '';
  const trimmed =
    text.slice(0, half) +
    `\n\n... (${omitted} bytes omitted.${pathNote}) ...\n\n` +
    text.slice(-half);

  return { trimmed, persisted, fullPath: persisted ? filePath : undefined };
}
