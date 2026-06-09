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
export type QueryIntent = 'why' | 'when' | 'how' | 'what_changed' | 'problem' | 'general';
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
/**
 * Detect the intent of a search query.
 *
 * Returns the best matching intent with confidence score and
 * type-specific boosting factors to apply during search.
 */
export declare function detectQueryIntent(query: string): IntentResult;
/**
 * Apply intent-based type boosting to a search result's score.
 *
 * @param score Original search score
 * @param type Observation type of the result
 * @param intentResult Detected intent from detectQueryIntent()
 * @returns Boosted score
 */
export declare function applyIntentBoost(score: number, type: string, intentResult: IntentResult): number;
//# sourceMappingURL=intent-detector.d.ts.map