/**
 * Memory Formation — Stage 3: Evaluate
 *
 * Assesses the long-term knowledge value of a memory and classifies it
 * into one of three categories:
 *
 * - core:       High-value reusable knowledge (decisions, gotchas, root causes)
 * - contextual: Moderately useful context (file changes, command results)
 * - ephemeral:  Low-value process noise (trivial edits, status logs)
 *
 * The value score determines storage behavior:
 * - core (>= 0.7):      Store with high importance, never auto-decay
 * - contextual (0.4-0.7): Store normally, subject to retention decay
 * - ephemeral (< 0.4):  Discard or store with aggressive auto-decay
 */

import type { ObservationType } from '../../types.js';
import type { ExtractResult, EvaluateResult, ValueCategory } from './types.js';

// ── Scoring Weights ──────────────────────────────────────────────

/** Base value weight per observation type */
const TYPE_WEIGHTS: Record<ObservationType, number> = {
  'gotcha':           0.85,
  'decision':         0.80,
  'problem-solution': 0.75,
  'trade-off':        0.70,
  'reasoning':        0.70,
  'why-it-exists':    0.65,
  'how-it-works':     0.60,
  'discovery':        0.55,
  'what-changed':     0.45,
  'session-request':  0.40,
  'reasoning':        0.60,
};

/** Patterns indicating high-specificity content (boost value) */
const SPECIFICITY_PATTERNS = [
  /\b\d+\.\d+\.\d+\b/,                     // Semantic version numbers
  /\b(ERR_|ENOENT|ECONNREFUSED|E[A-Z]{3,})\b/,  // Error codes
  /\b(port|PORT)\s*[:=]?\s*\d{2,5}\b/i,    // Port numbers
  /\bhttps?:\/\/\S+/,                       // URLs
  /`[^`]{3,60}`/,                           // Inline code references
  /\b[A-Z][A-Z0-9_]{3,}\b/,                // Constants (e.g., MAX_RETRIES)
  /\b\d+\s*(ms|s|sec|min|MB|GB|KB)\b/i,    // Measurements with units
];

/** Patterns indicating causal reasoning (boost value) */
const CAUSAL_PATTERNS = [
  /\b(because|therefore|due to|caused by|as a result|fixed by|resolved by)\b/i,
  /\b(so that|in order to|leads to|results in|prevents)\b/i,
  /(?:因为|所以|由于|导致|造成|因此|为了|解决)/,
];

/** Patterns indicating low-quality / noise content (reduce value) */
const NOISE_PATTERNS = [
  /^Session activity/i,
  /^Updated \S+\.\w+$/i,
  /^Created \S+\.\w+$/i,
  /^Deleted \S+\.\w+$/i,
  /^File written successfully/i,
  /^Command executed/i,
  /^Tool: (read_file|list_dir|find_by_name)/i,
  /^\s*$/,
];

/** Patterns indicating the content is just tool output, not knowledge */
const TOOL_OUTPUT_PATTERNS = [
  /^(file|directory|folder)\s+(created|deleted|moved|copied)/i,
  /^Successfully\s+(installed|updated|removed)/i,
  /^\d+ files? changed/i,
  /^npm (WARN|notice)/i,
  /^\s*at\s+\S+\s+\(/,  // Stack trace lines
];

// ── Evaluation Implementation ────────────────────────────────────

/**
 * Compute fact density: ratio of structured facts to narrative length.
 * Higher density = more structured, likely higher value.
 */
function factDensity(facts: string[], narrativeLength: number): number {
  if (narrativeLength === 0) return 0;
  // Each fact is worth ~20 chars of "structured knowledge"
  const structuredChars = facts.reduce((sum, f) => sum + f.length, 0);
  return Math.min(1, structuredChars / Math.max(narrativeLength, 100));
}

/**
 * Count how many specificity indicators are present in the content.
 */
function specificityScore(content: string): number {
  let count = 0;
  for (const p of SPECIFICITY_PATTERNS) {
    p.lastIndex = 0;
    if (p.test(content)) count++;
  }
  return Math.min(1, count / 3); // Normalize: 3+ indicators = max score
}

/**
 * Check if content contains causal reasoning.
 */
function causalScore(content: string): number {
  let count = 0;
  for (const p of CAUSAL_PATTERNS) {
    p.lastIndex = 0;
    if (p.test(content)) count++;
  }
  return Math.min(1, count / 2); // Normalize: 2+ causal patterns = max
}

/**
 * Check if content matches noise patterns.
 */
function noiseScore(title: string, narrative: string): number {
  let noisiness = 0;

  // Title noise
  for (const p of NOISE_PATTERNS) {
    if (p.test(title)) { noisiness += 0.3; break; }
  }

  // Narrative noise
  const lines = narrative.split('\n').filter(l => l.trim().length > 0);
  let toolOutputLines = 0;
  for (const line of lines) {
    for (const p of TOOL_OUTPUT_PATTERNS) {
      if (p.test(line)) { toolOutputLines++; break; }
    }
  }
  if (lines.length > 0) {
    noisiness += (toolOutputLines / lines.length) * 0.5;
  }

  // Very short narrative with no facts
  if (narrative.length < 50) noisiness += 0.2;

  return Math.min(1, noisiness);
}

/**
 * Classify value score into a category.
 */
function categorize(score: number): ValueCategory {
  if (score >= 0.6) return 'core';
  if (score >= 0.35) return 'contextual';
  return 'ephemeral';
}

/**
 * Build a human-readable reason string explaining the assessment.
 */
function buildReason(
  typeWeight: number,
  factDens: number,
  specificity: number,
  causal: number,
  noise: number,
  category: ValueCategory,
): string {
  const parts: string[] = [];

  if (typeWeight >= 0.7) parts.push('high-value type');
  else if (typeWeight <= 0.45) parts.push('low-value type');

  if (factDens > 0.3) parts.push('fact-dense');
  if (specificity > 0.3) parts.push('specific (versions/codes/paths)');
  if (causal > 0.3) parts.push('causal reasoning');
  if (noise > 0.3) parts.push('noisy content');

  const detail = parts.length > 0 ? parts.join(', ') : 'average content';
  return `${category}: ${detail}`;
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Run Stage 3: Evaluate.
 *
 * Assesses the knowledge value of an enriched memory using multi-factor
 * scoring. Returns a score (0-1), category, and explanation.
 */
export function runEvaluate(extracted: ExtractResult): EvaluateResult {
  const content = `${extracted.title} ${extracted.narrative} ${extracted.facts.join(' ')}`;

  // ── Factor scores ──
  const typeWeight = TYPE_WEIGHTS[extracted.type] ?? 0.5;
  const factDens = factDensity(extracted.facts, extracted.narrative.length);
  const specificity = specificityScore(content);
  const causal = causalScore(content);
  const noise = noiseScore(extracted.title, extracted.narrative);

  // ── Composite score ──
  // Weighted combination with noise as penalty
  // Type is the strongest signal (50%) — a gotcha or decision is inherently more valuable
  const rawScore = typeWeight * 0.50
    + factDens * 0.12
    + specificity * 0.12
    + causal * 0.12
    - noise * 0.14;

  // Bonus: system-extracted facts indicate the content has structure
  const extractionBonus = extracted.extractedFacts.length > 0 ? 0.05 : 0;

  // Bonus: title was improved (means original was generic → slightly penalize)
  const titlePenalty = extracted.titleImproved ? -0.03 : 0;

  // Bonus: type was auto-corrected (system found a better match → content has signals)
  const correctionBonus = extracted.typeCorrected ? 0.03 : 0;

  const score = Math.max(0, Math.min(1, rawScore + extractionBonus + titlePenalty + correctionBonus));
  const category = categorize(score);
  const reason = buildReason(typeWeight, factDens, specificity, causal, noise, category);

  return { score, category, reason };
}
