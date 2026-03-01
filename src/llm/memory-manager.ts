/**
 * LLM Memory Manager
 *
 * Uses LLM to intelligently manage memories — inspired by Mem0's
 * ADD/UPDATE/DELETE/NONE decision model and Cipher's fact extraction.
 *
 * This module is the core of the "premium" memory path:
 * - Extract structured facts from raw content
 * - Find duplicate/contradictory memories
 * - Decide: ADD new, UPDATE existing, DELETE outdated, or NONE (skip)
 *
 * Falls back gracefully to heuristic mode when LLM is not configured.
 */

import { callLLM, isLLMEnabled } from './provider.js';

/** The decision LLM makes for each memory operation */
export type MemoryAction = 'ADD' | 'UPDATE' | 'DELETE' | 'NONE';

/** Result of LLM fact extraction */
export interface ExtractedFacts {
  title: string;
  facts: string[];
  type: string;
  relevance: 'high' | 'medium' | 'low';
}

/** Result of LLM dedup decision */
export interface DedupDecision {
  action: MemoryAction;
  targetId?: number;
  reason: string;
  mergedContent?: string;
}

const FACT_EXTRACTION_PROMPT = `You are a coding memory assistant. Extract structured facts from the given content.

Rules:
- Extract only IMPORTANT facts worth remembering across sessions
- Focus on: decisions, bug fixes, configuration changes, architecture patterns, gotchas
- Skip trivial information: file reads, greetings, simple commands
- Each fact should be a single, self-contained statement
- Return "relevance": "low" if the content is not worth storing

Respond in JSON only:
{
  "title": "short 5-10 word title",
  "facts": ["fact 1", "fact 2"],
  "type": "decision|problem-solution|gotcha|what-changed|discovery|how-it-works|why-it-exists|trade-off|session-request",
  "relevance": "high|medium|low"
}`;

const DEDUP_PROMPT = `You are a coding memory deduplication assistant. Given a NEW memory and a list of EXISTING memories, decide the best action.

Actions:
- ADD: The new memory contains unique information not in existing memories. Store it.
- UPDATE: The new memory supersedes or improves an existing memory. Merge them.
- DELETE: An existing memory is outdated/wrong and the new one replaces it entirely.
- NONE: The new memory is redundant — existing memories already cover this. Skip it.

Rules:
- If the same topic was updated (e.g., "switched from MySQL to PostgreSQL"), UPDATE the old one
- If a bug was fixed that was previously reported as open, UPDATE the old bug report
- If a task was completed that was tracked as in-progress, UPDATE to mark completed
- If the new memory is just a minor variation of an existing one, choose NONE
- Prefer UPDATE over ADD+DELETE — keep history clean

Respond in JSON only:
{
  "action": "ADD|UPDATE|DELETE|NONE",
  "targetId": null or existing_memory_id,
  "reason": "brief explanation",
  "mergedContent": "merged narrative if action is UPDATE, otherwise null"
}`;

/**
 * Extract structured facts from content using LLM.
 * Returns null if LLM is not available (graceful degradation).
 */
export async function extractFacts(content: string): Promise<ExtractedFacts | null> {
  if (!isLLMEnabled()) return null;

  try {
    const response = await callLLM(FACT_EXTRACTION_PROMPT, content);
    const parsed = JSON.parse(response.content) as ExtractedFacts;

    // Validate structure
    if (!parsed.title || !Array.isArray(parsed.facts)) return null;

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Decide whether to ADD, UPDATE, DELETE, or skip a new memory
 * based on existing similar memories.
 *
 * Returns null if LLM is not available (graceful degradation).
 */
export async function deduplicateMemory(
  newMemory: { title: string; narrative: string; facts: string[] },
  existingMemories: Array<{ id: number; title: string; narrative: string; facts: string }>,
): Promise<DedupDecision | null> {
  if (!isLLMEnabled()) return null;
  if (existingMemories.length === 0) return { action: 'ADD', reason: 'No existing memories to compare' };

  const existingList = existingMemories
    .map(m => `[ID: ${m.id}] ${m.title}\n  ${m.narrative}\n  Facts: ${m.facts}`)
    .join('\n\n');

  const userMessage = `NEW MEMORY:
Title: ${newMemory.title}
Content: ${newMemory.narrative}
Facts: ${newMemory.facts.join('; ')}

EXISTING MEMORIES:
${existingList}`;

  try {
    const response = await callLLM(DEDUP_PROMPT, userMessage);
    const parsed = JSON.parse(response.content) as DedupDecision;

    // Validate structure
    if (!parsed.action || !['ADD', 'UPDATE', 'DELETE', 'NONE'].includes(parsed.action)) {
      return { action: 'ADD', reason: 'LLM response invalid, defaulting to ADD' };
    }

    return parsed;
  } catch {
    return { action: 'ADD', reason: 'LLM call failed, defaulting to ADD' };
  }
}
