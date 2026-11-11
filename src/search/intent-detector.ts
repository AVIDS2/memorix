/**
 * Intent-Aware Recall — Query Intent Detection
 *
 * Detects the underlying intent of a search query (why/when/how/what)
 * and returns type-specific boosting factors to improve recall precision.
 *
 * Inspired by MemCP's intent routing architecture.
 * Uses fast keyword/pattern matching (no LLM needed).
 */

import type { ObservationType } from '../types.js';

// ─── Types ───

export type QueryIntent = 'why' | 'when' | 'how' | 'what_changed' | 'problem' | 'state' | 'general';

export interface IntentResult {
  /** Detected intent category */
  intent: QueryIntent;
  /** Confidence score 0-1 */
  confidence: number;
  /** Observation type → boost multiplier (applied to search scores) */
  typeBoosts: Partial<Record<ObservationType, number>>;
  /** Field weight overrides for Orama search (optional) */
  fieldBoosts?: Record<string, number>;
  /** Whether to prefer chronological ordering over relevance */
  preferChronological: boolean;
  /** Source → boost multiplier for source-aware retrieval */
  sourceBoosts?: Partial<Record<'agent' | 'git' | 'manual', number>>;
}

// ─── Intent Patterns ───

interface IntentPattern {
  intent: QueryIntent;
  patterns: RegExp[];
  /** Higher weight = stronger match when multiple intents match */
  weight: number;
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    // Resumption queries — "where were we", "what's left". Weighted just above the
    // others because these are asked at handoff time, when returning the current
    // state matters more than returning the best semantic match.
    intent: 'state',
    patterns: [
      /\bprogress\b/i,
      /\bstatus\b/i,
      /\bremaining\b/i,
      /\bnext steps?\b/i,
      /\bwhere (?:did|are) we\b/i,
      /\bpick(?:ing)? up\b/i,
      /\bresume\b/i,
      /\bto-?do\b/i,
      /进度/,
      /做到哪/,
      /下一步/,
      /待办/,
      /剩下/,
      /继续/,
      /接着做/,
    ],
    weight: 1.1,
  },
  {
    intent: 'why',
    patterns: [
      /\bwhy\b/i,
      /\breason(?:s|ing)?\b/i,
      /\brationale\b/i,
      /\bmotivat(?:ion|ed)\b/i,
      /\bjustif(?:y|ication)\b/i,
      /\bchose|chosen|picked\b/i,
      /\bdecid(?:e[ds]?|ing)\b/i,
      /\btrade-?off\b/i,
      /为什么/,
      /原因/,
      /理由/,
      /为何/,
    ],
    weight: 1.0,
  },
  {
    intent: 'when',
    patterns: [
      /\bwhen\b/i,
      /\btimeline\b/i,
      /\bhistory\b/i,
      /\blast\s+(week|month|time|session)\b/i,
      /\brecent(?:ly)?\b/i,
      /\byesterday\b/i,
      /\btoday\b/i,
      /\bchronolog/i,
      /什么时候/,
      /何时/,
      /最近/,
      /上次/,
    ],
    weight: 0.9,
  },
  {
    intent: 'how',
    patterns: [
      /\bhow\s+(does|do|to|is|can|did|should|would)\b/i,
      /\barchitecture\b/i,
      /\bmechanism\b/i,
      /\bimplement(?:ation|ed|ing)?\b/i,
      /\bwork(?:s|ing|ed)?\b/i,
      /\bexplain\b/i,
      /\bunderstand\b/i,
      /怎么/,
      /如何/,
      /机制/,
      /原理/,
      /架构/,
    ],
    weight: 0.85,
  },
  {
    intent: 'what_changed',
    patterns: [
      /\bwhat\s+changed\b/i,
      /\bwhat\s+was\s+(modified|updated|changed)\b/i,
      /\bdiff(?:erence)?\b/i,
      /\bchangelog\b/i,
      /\bmodifi(?:ed|cation)\b/i,
      /\bupdat(?:e[ds]?|ing)\b/i,
      /\brefactor(?:ed|ing)?\b/i,
      /改了/,
      /修改/,
      /变更/,
      /变化/,
    ],
    weight: 0.8,
  },
  {
    intent: 'problem',
    patterns: [
      /\bbug(?:s|gy)?\b/i,
      /\berror(?:s)?\b/i,
      /\bfix(?:e[ds]|ing)?\b/i,
      /\bissue(?:s)?\b/i,
      /\bproblem(?:s)?\b/i,
      /\bcrash(?:e[ds]|ing)?\b/i,
      /\bfail(?:e[ds]|ure|ing)?\b/i,
      /\bbroken\b/i,
      /\bgotcha\b/i,
      /\bpitfall\b/i,
      /\bworkaround\b/i,
      /\btroubleshoot/i,
      /\bdebug(?:ging)?\b/i,
      /报错/,
      /问题/,
      /修复/,
      /故障/,
      /异常/,
    ],
    weight: 0.9,
  },
];

// ─── Type Boost Maps ───

const INTENT_TYPE_BOOSTS: Record<QueryIntent, Partial<Record<ObservationType, number>>> = {
  state: {
    'session-request': 2.5,
    'what-changed': 2.0,
    'discovery': 1.5,
    'problem-solution': 1.2,
  },
  why: {
    'decision': 3.0,
    'why-it-exists': 3.0,
    'trade-off': 2.5,
    'how-it-works': 1.2,
  },
  when: {
    // Temporal queries don't strongly prefer any type — they prefer recency
    'what-changed': 1.5,
    'session-request': 1.3,
  },
  how: {
    'how-it-works': 3.0,
    'discovery': 2.0,
    'decision': 1.3,
  },
  what_changed: {
    'what-changed': 3.0,
    'discovery': 1.5,
    'session-request': 1.2,
  },
  problem: {
    'problem-solution': 3.0,
    'gotcha': 2.5,
    'discovery': 1.3,
  },
  general: {
    // No special boosting
  },
};

// ─── Source Boost Maps ───
// Maps intent to preferred memory sources for source-aware retrieval.
// git source = ground truth (commits), agent source = reasoning/decisions.

const INTENT_SOURCE_BOOSTS: Partial<Record<QueryIntent, Partial<Record<'agent' | 'git' | 'manual', number>>>> = {
  what_changed: {
    git: 2.0,      // "what changed" → prefer commit-derived ground truth
    agent: 0.8,
  },
  when: {
    git: 1.8,      // Temporal queries → git has precise timestamps
    agent: 1.0,
  },
  why: {
    agent: 2.0,    // "why" → prefer reasoning/decision memories
    git: 0.7,      // commits rarely explain WHY
  },
  how: {
    agent: 1.5,    // "how" → prefer explanations
    git: 1.0,
  },
  problem: {
    git: 1.5,      // Bug fixes often in commit history
    agent: 1.5,    // But also in problem-solution memories
  },
};

const INTENT_FIELD_BOOSTS: Partial<Record<QueryIntent, Record<string, number>>> = {
  state: {
    title: 3,           // State notes are titled by topic — the title carries the signal
    entityName: 1.5,
    narrative: 2,
    facts: 2.5,         // Progress lines usually live in facts
    concepts: 1,
    filesModified: 0.5,
  },
  why: {
    title: 2,
    entityName: 1.5,
    narrative: 2.5,     // WHY queries need narrative context
    facts: 1.5,
    concepts: 1,
    filesModified: 0.3,
  },
  problem: {
    title: 3,
    entityName: 2,
    narrative: 2,
    facts: 2,           // Bug details often in facts
    concepts: 1,
    filesModified: 1.5, // File paths help find the right bug fix
  },
};

// ─── Detection ───

/**
 * Detect the intent of a search query.
 *
 * Returns the best matching intent with confidence score and
 * type-specific boosting factors to apply during search.
 */
export function detectQueryIntent(query: string): IntentResult {
  if (!query || query.length < 2) {
    return {
      intent: 'general',
      confidence: 0,
      typeBoosts: {},
      preferChronological: false,
    };
  }

  let bestIntent: QueryIntent = 'general';
  let bestScore = 0;
  let totalMatches = 0;

  for (const { intent, patterns, weight } of INTENT_PATTERNS) {
    let matchCount = 0;
    for (const pattern of patterns) {
      if (pattern.test(query)) matchCount++;
    }
    if (matchCount > 0) {
      const score = matchCount * weight;
      totalMatches += matchCount;
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }
  }

  // Confidence: how strongly did we match vs. random noise
  const confidence = totalMatches === 0
    ? 0
    : Math.min(1, bestScore / 2); // 2+ pattern matches → high confidence

  return {
    intent: bestIntent,
    confidence,
    typeBoosts: INTENT_TYPE_BOOSTS[bestIntent],
    fieldBoosts: INTENT_FIELD_BOOSTS[bestIntent],
    sourceBoosts: INTENT_SOURCE_BOOSTS[bestIntent],
    preferChronological: bestIntent === 'when',
  };
}

/**
 * Apply intent-based type boosting to a search result's score.
 *
 * @param score Original search score
 * @param type Observation type of the result
 * @param intentResult Detected intent from detectQueryIntent()
 * @returns Boosted score
 */
export function applyIntentBoost(
  score: number,
  type: string,
  intentResult: IntentResult,
): number {
  if (intentResult.confidence < 0.3) return score; // Low confidence → no boost
  const boost = intentResult.typeBoosts[type as ObservationType] ?? 1.0;
  // Scale boost by confidence: full boost at confidence=1, partial at lower
  const effectiveBoost = 1 + (boost - 1) * intentResult.confidence;
  return score * effectiveBoost;
}
