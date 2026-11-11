/**
 * Memory Compact Engine
 *
 * Dual-mode memory management inspired by:
 * - Mem0's ADD/UPDATE/DELETE/NONE decision model with content merging
 * - Cipher's dual-mode architecture (LLM + heuristic fallback)
 *
 * Two paths:
 * 1. LLM mode (compactOnWrite): Single LLM call → extract facts + compare + decide + merge
 * 2. Free mode (heuristicCompact): Vector similarity → rule-based ADD/UPDATE/NONE
 *
 * Both paths produce a CompactDecision that the caller executes.
 */

import { callLLM, isLLMEnabled } from './provider.js';

/** The decision the compact engine makes for each memory operation */
export type MemoryAction = 'ADD' | 'UPDATE' | 'DELETE' | 'NONE';

/** Existing memory entry for comparison */
export interface ExistingMemory {
  id: number;
  title: string;
  narrative: string;
  facts: string;
  score: number;
}

/** The compact decision — what to do with the new memory */
export interface CompactDecision {
  action: MemoryAction;
  /** ID of existing memory to UPDATE/DELETE */
  targetId?: number;
  /** Brief explanation of why this action was chosen */
  reason: string;
  /** Merged narrative for UPDATE (Mem0-style rewrite) */
  mergedNarrative?: string;
  /** Merged facts for UPDATE */
  mergedFacts?: string[];
  /** LLM-extracted enriched facts (only in LLM mode) */
  enrichedFacts?: string[];
  /** Whether LLM was used for this decision */
  usedLLM: boolean;
}

/**
 * Unified Compact on Write prompt (Mem0-inspired, single LLM call).
 *
 * This prompt does 3 things in 1 call:
 * 1. Extract structured facts from the new content
 * 2. Compare with existing similar memories
 * 3. Decide ADD/UPDATE/DELETE/NONE and merge if needed
 */
const COMPACT_ON_WRITE_PROMPT = `You are a smart coding memory manager. You control the memory of a cross-IDE coding assistant.

You receive a NEW MEMORY to store and a list of EXISTING similar memories. Your job:
1. Extract the key facts from the new memory
2. Compare with existing memories
3. Decide the best action

Actions:
- ADD: New memory contains unique information. Store it as-is.
- UPDATE: New memory supersedes or improves an existing one. Merge them into a single, comprehensive memory.
- DELETE: An existing memory is outdated/contradicted by the new one. Remove it.
- NONE: New memory is redundant. Existing memories already cover this. Skip storing.

Decision rules:
- Same topic updated (e.g., "MySQL → PostgreSQL"): UPDATE the old memory with merged content
- Bug fixed that was reported as open: UPDATE the bug report to include the fix
- Task completed that was tracked as in-progress: UPDATE to mark completed
- Minor variation of existing memory: NONE (skip)
- Completely new topic: ADD
- Old info directly contradicted: DELETE the old one
- Prefer UPDATE over ADD — keep memory count low, merge information

For UPDATE: write a merged narrative that combines the best of both old and new, preserving all important details. Also merge the facts lists, removing duplicates.

Respond in JSON only:
{
  "action": "ADD" | "UPDATE" | "DELETE" | "NONE",
  "targetId": null or existing_memory_id_number,
  "reason": "brief explanation of decision",
  "mergedNarrative": "merged narrative text (required for UPDATE, null otherwise)",
  "mergedFacts": ["merged fact 1", "merged fact 2"] or null,
  "extractedFacts": ["fact extracted from new content 1", "fact 2"]
}`;

// ─── Heuristic Constants (Cipher-inspired) ───────────────────────────

/** Similarity threshold above which we consider memories as "same topic" */
const SIMILARITY_HIGH = 0.75;
/** Similarity threshold for "related but different" */
const SIMILARITY_MEDIUM = 0.5;

// ─── LLM Mode ────────────────────────────────────────────────────────

/**
 * Compact on Write — LLM mode.
 *
 * Single LLM call that extracts facts, compares with existing memories,
 * and decides ADD/UPDATE/DELETE/NONE with merged content.
 *
 * Inspired by Mem0's `get_update_memory_messages` but unified into 1 call.
 */
export async function compactOnWrite(
  newMemory: { title: string; narrative: string; facts: string[] },
  existingMemories: ExistingMemory[],
): Promise<CompactDecision> {
  if (!isLLMEnabled()) {
    return heuristicCompact(newMemory, existingMemories);
  }

  if (existingMemories.length === 0) {
    return { action: 'ADD', reason: 'No existing memories to compare', usedLLM: false };
  }

  // Build the prompt with new + existing memories (Mem0's temp_uuid_mapping approach)
  const existingList = existingMemories
    .map(m => `[ID: ${m.id}] (similarity: ${m.score.toFixed(2)}) ${m.title}\n  Narrative: ${m.narrative}\n  Facts: ${m.facts}`)
    .join('\n\n');

  const userMessage = `NEW MEMORY:
Title: ${newMemory.title}
Narrative: ${newMemory.narrative}
Facts: ${newMemory.facts.join('; ')}

EXISTING SIMILAR MEMORIES:
${existingList}`;

  try {
    const response = await callLLM(COMPACT_ON_WRITE_PROMPT, userMessage);

    // Parse response — handle markdown code blocks
    let content = response.content.trim();
    if (content.startsWith('```')) {
      content = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(content) as {
      action: string;
      targetId?: number | null;
      reason?: string;
      mergedNarrative?: string | null;
      mergedFacts?: string[] | null;
      extractedFacts?: string[] | null;
    };

    // Validate action
    const action = parsed.action?.toUpperCase() as MemoryAction;
    if (!action || !['ADD', 'UPDATE', 'DELETE', 'NONE'].includes(action)) {
      return { action: 'ADD', reason: 'LLM response invalid, defaulting to ADD', usedLLM: true };
    }

    // Validate targetId exists in existing memories for UPDATE/DELETE
    if ((action === 'UPDATE' || action === 'DELETE') && parsed.targetId != null) {
      const targetExists = existingMemories.some(m => m.id === parsed.targetId);
      if (!targetExists) {
        // LLM hallucinated an ID (common issue noted in Mem0's code)
        return { action: 'ADD', reason: `LLM referenced non-existent memory #${parsed.targetId}, defaulting to ADD`, usedLLM: true };
      }
    }

    return {
      action,
      targetId: parsed.targetId ?? undefined,
      reason: parsed.reason ?? 'LLM decision',
      mergedNarrative: parsed.mergedNarrative ?? undefined,
      mergedFacts: parsed.mergedFacts ?? undefined,
      enrichedFacts: parsed.extractedFacts ?? undefined,
      usedLLM: true,
    };
  } catch (err) {
    // LLM failed — fall back to heuristic
    console.error(`[memorix] LLM compact failed, falling back to heuristic:`, (err as Error)?.message ?? err);
    return heuristicCompact(newMemory, existingMemories);
  }
}

// ─── Free Mode (Heuristic) ───────────────────────────────────────────

/**
 * Heuristic Compact — Free mode, no LLM needed.
 *
 * Uses vector similarity scores from search results to make decisions.
 * Inspired by Cipher's fallback logic in extract_and_operate_memory.ts.
 *
 * Decision logic:
 * - score >= 0.75: Very similar → check if new is more complete
 *   - New is longer/richer → UPDATE (merge)
 *   - Otherwise → NONE (skip, already covered)
 * - score >= 0.50: Related topic
 *   - Same entity + same type → UPDATE if new has more facts
 *   - Otherwise → ADD (different enough)
 * - score < 0.50: Different topic → ADD
 */
export function heuristicCompact(
  newMemory: { title: string; narrative: string; facts: string[] },
  existingMemories: ExistingMemory[],
): CompactDecision {
  if (existingMemories.length === 0) {
    return { action: 'ADD', reason: 'No existing memories to compare', usedLLM: false };
  }

  const best = existingMemories[0]; // Already sorted by score

  // High similarity — very likely same topic
  if (best.score >= SIMILARITY_HIGH) {
    const newLength = newMemory.narrative.length + newMemory.facts.join(' ').length;
    const oldLength = best.narrative.length + best.facts.length;

    if (newLength > oldLength * 1.2) {
      // New memory is substantially richer — UPDATE with merged content
      const mergedNarrative = mergeTexts(best.narrative, newMemory.narrative);
      const mergedFacts = mergeFacts(best.facts, newMemory.facts.join('\n'));
      return {
        action: 'UPDATE',
        targetId: best.id,
        reason: `New memory is more comprehensive (${newLength} > ${oldLength} chars)`,
        mergedNarrative,
        mergedFacts,
        usedLLM: false,
      };
    }

    // New memory is not richer — skip it
    return {
      action: 'NONE',
      targetId: best.id,
      reason: `Existing memory #${best.id} already covers this topic (similarity: ${best.score.toFixed(2)})`,
      usedLLM: false,
    };
  }

  // Medium similarity — related but might be different enough
  if (best.score >= SIMILARITY_MEDIUM) {
    const newFactCount = newMemory.facts.length;
    const oldFactCount = best.facts.split('\n').filter(Boolean).length;

    if (newFactCount > oldFactCount) {
      // New has more facts — UPDATE
      const mergedNarrative = mergeTexts(best.narrative, newMemory.narrative);
      const mergedFacts = mergeFacts(best.facts, newMemory.facts.join('\n'));
      return {
        action: 'UPDATE',
        targetId: best.id,
        reason: `New memory has more facts (${newFactCount} > ${oldFactCount}), merging`,
        mergedNarrative,
        mergedFacts,
        usedLLM: false,
      };
    }

    // Related but not richer — ADD as separate memory
    return { action: 'ADD', reason: `Related to #${best.id} but different enough to keep separate`, usedLLM: false };
  }

  // Low similarity — new topic
  return { action: 'ADD', reason: 'No similar memories found', usedLLM: false };
}

// ─── Content Merging Utilities ───────────────────────────────────────

/**
 * Merge two narrative texts, keeping the more comprehensive version
 * while preserving unique information from both.
 */
function mergeTexts(oldText: string, newText: string): string {
  // If new text is significantly longer, prefer it
  if (newText.length > oldText.length * 1.5) return newText;
  // If old text is significantly longer, append new info
  if (oldText.length > newText.length * 1.5) return oldText;
  // Similar length — combine with separator
  return `${newText}\n\n[Previous context]: ${oldText}`;
}

/**
 * Merge two fact lists, removing duplicates.
 * oldFacts is newline-separated string, newFacts is array.
 */
function mergeFacts(oldFactsStr: string, newFactsStr: string): string[] {
  const oldFacts = oldFactsStr.split('\n').filter(Boolean).map(f => f.trim());
  const newFacts = newFactsStr.split('\n').filter(Boolean).map(f => f.trim());

  const seen = new Set<string>();
  const merged: string[] = [];

  // Add new facts first (they're more recent)
  for (const f of newFacts) {
    const normalized = f.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      merged.push(f);
    }
  }

  // Add old facts that aren't duplicates
  for (const f of oldFacts) {
    const normalized = f.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      merged.push(f);
    }
  }

  return merged;
}

// ─── Batch Dedup (for memorix_deduplicate tool) ──────────────────────

/**
 * LLM-powered dedup for batch cleanup.
 * Compares a new memory against existing ones and returns a decision.
 * Used by memorix_deduplicate tool.
 */
export async function deduplicateMemory(
  newMemory: { title: string; narrative: string; facts: string[] },
  existingMemories: Array<{ id: number; title: string; narrative: string; facts: string }>,
): Promise<CompactDecision | null> {
  if (!isLLMEnabled()) return null;
  if (existingMemories.length === 0) return { action: 'ADD', reason: 'No existing memories', usedLLM: false };

  const asExisting: ExistingMemory[] = existingMemories.map(m => ({
    ...m,
    score: 0.8, // Batch dedup assumes high similarity (pre-filtered)
  }));

  return compactOnWrite(newMemory, asExisting);
}
