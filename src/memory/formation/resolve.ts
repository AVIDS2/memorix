/**
 * Memory Formation — Stage 2: Resolve
 *
 * Determines what to do with an enriched memory: create new, merge into
 * existing, evolve (supersede), or discard as redundant.
 *
 * This stage absorbs and replaces the previous "Compact on Write" logic
 * (src/llm/memory-manager.ts) with a richer resolution model:
 *
 * - new:     Truly new knowledge → proceed to store
 * - merge:   Same topic as existing → UPDATE with combined content
 * - evolve:  Existing is outdated → UPDATE with new content as primary
 * - discard: Redundant or noise → skip storage entirely
 *
 * Rules-based mode uses similarity scores, entity overlap, fact comparison,
 * and contradiction detection to make decisions without LLM.
 */

import type { ExtractResult, ResolveResult, SearchHit, ExistingMemoryRef } from './types.js';

// ── Thresholds ───────────────────────────────────────────────────

/** Above this: very likely same topic */
const SIMILARITY_HIGH = 0.75;
/** Above this: related topic */
const SIMILARITY_MEDIUM = 0.50;
/** Above this: exact duplicate — discard */
const SIMILARITY_DUPLICATE = 0.90;

// ── Content Comparison Utilities ─────────────────────────────────

/**
 * Compute Jaccard similarity between two sets of normalized words.
 */
function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  return intersection / Math.max(wordsA.size, wordsB.size);
}

/**
 * Check if two entity names refer to the same concept.
 */
function entitiesMatch(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/[-_]/g, '');
  const nb = b.toLowerCase().replace(/[-_]/g, '');
  if (na === nb) return true;
  if (na.length >= 3 && nb.length >= 3) {
    if (na.includes(nb) || nb.includes(na)) return true;
  }
  return false;
}

/**
 * Detect potential contradiction between old and new content.
 * Looks for negation patterns and opposing statements.
 */
function hasContradiction(oldText: string, newText: string): boolean {
  // Simple heuristic: check for "not X" in new when "X" is in old
  const negationPatterns = [
    /\bnot\s+(\w+)/gi,
    /\bno longer\b/i,
    /\binstead of\b/i,
    /\breplaced\b.*\bwith\b/i,
    /\bremoved\b/i,
    /\bdeprecated\b/i,
    /\bobsolete\b/i,
    /不再/,
    /已弃用/,
    /替换为/,
    /改为/,
  ];

  return negationPatterns.some(p => p.test(newText));
}

/**
 * Merge two narratives, keeping the most comprehensive version.
 */
function mergeNarratives(oldNarrative: string, newNarrative: string): string {
  if (newNarrative.length > oldNarrative.length * 1.5) return newNarrative;
  if (oldNarrative.length > newNarrative.length * 1.5) return oldNarrative;
  return `${newNarrative}\n\n[Previous context]: ${oldNarrative}`;
}

/**
 * Merge two fact lists, deduplicating by normalized text.
 */
function mergeFacts(oldFacts: string[], newFacts: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  // New facts first (more recent)
  for (const f of newFacts) {
    const norm = f.toLowerCase().trim();
    if (!seen.has(norm) && f.trim().length > 0) {
      seen.add(norm);
      merged.push(f);
    }
  }
  for (const f of oldFacts) {
    const norm = f.toLowerCase().trim();
    if (!seen.has(norm) && f.trim().length > 0) {
      seen.add(norm);
      merged.push(f);
    }
  }

  return merged;
}

// ── LLM Resolution (Mem0-style) ───────────────────────────────

const LLM_RESOLVE_PROMPT = `You are a Memory Consolidation Manager for a software engineering knowledge base.

You must decide what to do with a NEW memory given EXISTING memories that are similar.

Operations:
- ADD: The new memory contains genuinely new information not present in existing memories.
- UPDATE: The new memory adds to or refines an existing memory. Specify which existing memory ID to update.
- DELETE: The new memory contradicts an existing memory. Specify which existing memory ID to delete.
- NOOP: The new memory is redundant (already covered by existing memories). Skip storage.

Rules:
- Return ONLY a JSON object
- If UPDATE: merge the best information from both old and new
- If DELETE: the new memory supersedes the old (contradiction detected)
- Prefer UPDATE over ADD when the topic is the same but information differs
- Prefer NOOP over ADD when the information is essentially the same

Response format:
{"action": "ADD|UPDATE|DELETE|NOOP", "targetId": <number or null>, "reason": "<brief explanation>", "mergedText": "<merged content for UPDATE, or null>"}`;

async function resolveWithLLM(
  extracted: ExtractResult,
  hits: SearchHit[],
  getObservation: (id: number) => ExistingMemoryRef | null,
): Promise<ResolveResult | null> {
  try {
    const { callLLM } = await import('../../llm/provider.js');

    // Build context for LLM
    const existingMemories = hits.slice(0, 5).map((h, i) => ({
      id: h.observationId,
      index: i,
      title: h.title,
      content: h.narrative.substring(0, 300),
      facts: h.facts.substring(0, 200),
    }));

    const input = `NEW MEMORY:
Title: ${extracted.title}
Content: ${extracted.narrative.substring(0, 500)}
Facts: ${extracted.facts.join('; ')}

EXISTING MEMORIES:
${existingMemories.map(m => `[ID:${m.id}] ${m.title} | ${m.content} | Facts: ${m.facts}`).join('\n')}`;

    const response = await callLLM(LLM_RESOLVE_PROMPT, input);
    const text = response.content.trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);

    const action = parsed.action?.toUpperCase();
    const targetId = parsed.targetId ? Number(parsed.targetId) : undefined;
    const reason = parsed.reason || 'LLM decision';

    if (action === 'NOOP') {
      return { action: 'discard', targetId, reason: `LLM: ${reason}` };
    }
    if (action === 'ADD') {
      return { action: 'new', reason: `LLM: ${reason}` };
    }
    if (action === 'UPDATE' && targetId) {
      const existing = getObservation(targetId);
      const oldFacts = existing?.facts ?? [];
      return {
        action: 'merge',
        targetId,
        reason: `LLM: ${reason}`,
        mergedNarrative: parsed.mergedText || mergeNarratives(existing?.narrative ?? '', extracted.narrative),
        mergedFacts: mergeFacts(oldFacts, extracted.facts),
      };
    }
    if (action === 'DELETE' && targetId) {
      const existing = getObservation(targetId);
      const oldFacts = existing?.facts ?? [];
      return {
        action: 'evolve',
        targetId,
        reason: `LLM: ${reason}`,
        mergedNarrative: extracted.narrative,
        mergedFacts: mergeFacts(oldFacts, extracted.facts),
      };
    }

    return null; // Unrecognized action
  } catch {
    return null; // LLM failure → fall back to rules
  }
}

// ── Resolve Implementation ───────────────────────────────────────

/**
 * Score a candidate match for resolution.
 * Returns a composite score considering similarity, entity overlap, and content richness.
 */
function scoreCandidate(
  extracted: ExtractResult,
  candidate: SearchHit,
): { score: number; entityMatch: boolean; richer: boolean; contradiction: boolean } {
  const entityMatch = entitiesMatch(extracted.entityName, candidate.entityName);
  const contentOverlap = wordOverlap(
    `${extracted.title} ${extracted.narrative}`,
    `${candidate.title} ${candidate.narrative}`,
  );

  // Composite score: search similarity + entity match bonus + content overlap
  const score = candidate.score * 0.6
    + (entityMatch ? 0.2 : 0)
    + contentOverlap * 0.2;

  // Is new memory richer?
  const newLength = extracted.narrative.length + extracted.facts.join(' ').length;
  const oldLength = candidate.narrative.length + candidate.facts.length;
  const richer = newLength > oldLength * 1.15;

  const contradiction = hasContradiction(candidate.narrative, extracted.narrative);

  return { score, entityMatch, richer, contradiction };
}

/**
 * Run Stage 2: Resolve.
 *
 * Determines the resolution action for an enriched memory by comparing
 * it against existing memories found via search.
 */
export async function runResolve(
  extracted: ExtractResult,
  projectId: string,
  searchMemories: (query: string, limit: number, projectId: string) => Promise<SearchHit[]>,
  getObservation: (id: number) => ExistingMemoryRef | null,
  useLLM = false,
): Promise<ResolveResult> {
  // Search for similar existing memories
  const query = `${extracted.title} ${extracted.narrative.substring(0, 200)}`;
  let hits: SearchHit[];
  try {
    hits = await searchMemories(query, 5, projectId);
  } catch {
    // Search failed — default to ADD
    return { action: 'new', reason: 'Search unavailable, defaulting to new' };
  }

  if (hits.length === 0) {
    return { action: 'new', reason: 'No similar existing memories found' };
  }

  // LLM-powered resolution (Mem0-style, quality-first)
  if (useLLM) {
    const llmResult = await resolveWithLLM(extracted, hits, getObservation);
    if (llmResult) return llmResult;
    // LLM failed → fall through to rules-based resolution
  }

  // Rules-based resolution (free mode fallback)
  const scored = hits.map(hit => ({
    hit,
    ...scoreCandidate(extracted, hit),
  }));

  // Sort by composite score descending
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  // ── Decision logic ──

  // Very high raw search similarity → likely duplicate (use raw score, not composite)
  if (best.hit.score >= SIMILARITY_DUPLICATE) {
    if (best.richer) {
      // New is richer → evolve (supersede)
      const existing = getObservation(best.hit.observationId);
      const oldFacts = existing?.facts ?? best.hit.facts.split('\n').filter(Boolean);
      return {
        action: 'evolve',
        targetId: best.hit.observationId,
        reason: `Near-duplicate of #${best.hit.observationId} but richer content (score: ${best.score.toFixed(2)})`,
        mergedNarrative: mergeNarratives(best.hit.narrative, extracted.narrative),
        mergedFacts: mergeFacts(oldFacts, extracted.facts),
      };
    }
    return {
      action: 'discard',
      targetId: best.hit.observationId,
      reason: `Duplicate of #${best.hit.observationId} (score: ${best.score.toFixed(2)})`,
    };
  }

  // High similarity → same topic
  if (best.score >= SIMILARITY_HIGH) {
    if (best.contradiction) {
      // Content contradicts existing → evolve
      const existing = getObservation(best.hit.observationId);
      const oldFacts = existing?.facts ?? best.hit.facts.split('\n').filter(Boolean);
      return {
        action: 'evolve',
        targetId: best.hit.observationId,
        reason: `Supersedes #${best.hit.observationId}: contradiction detected (score: ${best.score.toFixed(2)})`,
        mergedNarrative: extracted.narrative,
        mergedFacts: mergeFacts(oldFacts, extracted.facts),
      };
    }

    if (best.richer) {
      // New is richer → merge
      const existing = getObservation(best.hit.observationId);
      const oldFacts = existing?.facts ?? best.hit.facts.split('\n').filter(Boolean);
      return {
        action: 'merge',
        targetId: best.hit.observationId,
        reason: `Merging with #${best.hit.observationId}: same topic, new content is richer (score: ${best.score.toFixed(2)})`,
        mergedNarrative: mergeNarratives(best.hit.narrative, extracted.narrative),
        mergedFacts: mergeFacts(oldFacts, extracted.facts),
      };
    }

    // Not richer → discard
    return {
      action: 'discard',
      targetId: best.hit.observationId,
      reason: `Already covered by #${best.hit.observationId} (score: ${best.score.toFixed(2)})`,
    };
  }

  // Medium similarity + entity match → merge
  if (best.score >= SIMILARITY_MEDIUM && best.entityMatch) {
    const existing = getObservation(best.hit.observationId);
    const oldFacts = existing?.facts ?? best.hit.facts.split('\n').filter(Boolean);
    const newFactCount = extracted.facts.length;
    const oldFactCount = oldFacts.length;

    if (newFactCount > oldFactCount) {
      return {
        action: 'merge',
        targetId: best.hit.observationId,
        reason: `Same entity "${extracted.entityName}", new memory has more facts (${newFactCount} > ${oldFactCount})`,
        mergedNarrative: mergeNarratives(best.hit.narrative, extracted.narrative),
        mergedFacts: mergeFacts(oldFacts, extracted.facts),
      };
    }
  }

  // Low similarity or different entity → new memory
  return { action: 'new', reason: `Different from existing memories (best score: ${best.score.toFixed(2)})` };
}
