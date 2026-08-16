/**
 * Memory Formation — Stage 1: Extract
 *
 * Enriches raw memory input with system-extracted facts, normalized titles,
 * resolved entity names, and verified observation types.
 *
 * Rules-based mode (no LLM):
 * - Fact extraction: key-value patterns, error messages, version numbers, paths
 * - Title normalization: replace generic titles with first meaningful sentence
 * - Entity resolution: match against existing Knowledge Graph entities
 * - Type inference: verify type matches content signals
 */

import type { ObservationType } from '../../types.js';
import type { FormationInput, ExtractResult } from './types.js';

// ── Fact Extraction Patterns ──────────────────────────────────────

/** Patterns that extract structured facts from narrative text */
const FACT_PATTERNS: Array<{ pattern: RegExp; format: (m: RegExpMatchArray) => string }> = [
  // Key: Value pairs (e.g., "Port: 3000", "Timeout = 60s")
  {
    pattern: /\b([A-Z][a-zA-Z_-]{2,30})\s*[:=]\s*([^\n,;]{2,60})/g,
    format: (m) => `${m[1]}: ${m[2].trim()}`,
  },
  // Arrow notation (e.g., "MySQL -> PostgreSQL", "v1.0 -> v2.0")
  {
    pattern: /\b(\S{2,30})\s*(?:->|=>|>)\s*(\S{2,30})/g,
    format: (m) => `${m[1]} -> ${m[2]}`,
  },
  // Version numbers (e.g., "v1.2.3", "version 2.0")
  {
    pattern: /\b(?:v(?:ersion)?\s*)(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)\b/gi,
    format: (m) => `Version: ${m[1]}`,
  },
  // Error messages (e.g., "Error: ...", "ERR_...")
  {
    pattern: /\b(?:Error|ERR|ENOENT|ECONNREFUSED|TypeError|RangeError|SyntaxError|ReferenceError)[:\s]+([^\n]{5,80})/gi,
    format: (m) => `Error: ${m[1].trim()}`,
  },
  // Port numbers in context
  {
    pattern: /\b(?:port|PORT)\s*[:=]?\s*(\d{2,5})\b/gi,
    format: (m) => `Port: ${m[1]}`,
  },
  // Environment variables
  {
    pattern: /\b([A-Z][A-Z0-9_]{3,30})\s*=\s*(\S{1,60})/g,
    format: (m) => `${m[1]}=${m[2]}`,
  },
  // npm/package versions (e.g., "react@18.2.0")
  {
    pattern: /\b([@a-z][\w./-]+)@(\d+\.\d+\.\d+(?:-[\w.]+)?)\b/g,
    format: (m) => `${m[1]}@${m[2]}`,
  },
];

/** Patterns indicating generic/low-quality titles that should be improved */
const GENERIC_TITLE_PATTERNS = [
  /^Updated \S+\.\w+$/i,
  /^Created \S+\.\w+$/i,
  /^Deleted \S+\.\w+$/i,
  /^Modified \S+\.\w+$/i,
  /^Changed \S+\.\w+$/i,
  /^Session activity/i,
  /^Activity \(/i,
  /^Used \w+$/i,
  /^Ran: /i,
];

/** Content signals mapped to observation types */
const TYPE_SIGNALS: Array<{ type: ObservationType; patterns: RegExp[] }> = [
  {
    type: 'problem-solution',
    patterns: [
      /\b(fix|fixed|bug|error|issue|crash|broken|resolved|workaround|patch)\b/i,
      /\b(修复|修正|解决|报错|崩溃|异常)\b/,
    ],
  },
  {
    type: 'gotcha',
    patterns: [
      /\b(gotcha|pitfall|trap|careful|warning|caveat|footgun|unexpected|beware)\b/i,
      /\b(坑|陷阱|注意|小心|踩坑)\b/,
    ],
  },
  {
    type: 'decision',
    patterns: [
      /\b(decided|chose|chosen|selected|adopted|rejected|evaluated|compared)\b/i,
      /\b(决定|选择|采用|弃用|对比|评估)\b/,
    ],
  },
  {
    type: 'what-changed',
    patterns: [
      /\b(changed|migrated|upgraded|refactored|replaced|renamed|moved|removed|added)\b/i,
      /\b(改|迁移|升级|重构|替换|重命名|删除|新增)\b/,
    ],
  },
  {
    type: 'how-it-works',
    patterns: [
      /\b(works by|architecture|mechanism|pipeline|flow|under the hood|internally)\b/i,
      /\b(原理|机制|流程|架构|内部)\b/,
    ],
  },
  {
    type: 'trade-off',
    patterns: [
      /\b(trade.?off|compromise|downside|cost|benefit|pro|con|versus|vs)\b/i,
      /\b(权衡|折中|代价|收益|优缺点)\b/,
    ],
  },
];

// ── Extract Implementation ───────────────────────────────────────

/**
 * Extract structured facts from narrative text using regex patterns.
 * Returns only facts not already present in the caller-provided list.
 */
function extractFacts(narrative: string, existingFacts: string[]): string[] {
  const existingLower = new Set(existingFacts.map(f => f.toLowerCase().trim()));
  const extracted: string[] = [];
  const seen = new Set<string>();

  for (const { pattern, format } of FACT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(narrative)) !== null) {
      const fact = format(match);
      const normalized = fact.toLowerCase().trim();

      // Skip if already provided by caller or already extracted
      if (existingLower.has(normalized) || seen.has(normalized)) continue;

      // Skip very short or very long facts
      if (fact.length < 5 || fact.length > 120) continue;

      seen.add(normalized);
      extracted.push(fact);
    }
  }

  return extracted.slice(0, 10); // Cap at 10 system-extracted facts
}

/**
 * Improve a generic title by extracting the first meaningful sentence
 * from the narrative.
 */
function improveTitle(title: string, narrative: string): { title: string; improved: boolean } {
  const isGeneric = GENERIC_TITLE_PATTERNS.some(p => p.test(title));
  if (!isGeneric) return { title, improved: false };

  // Try to extract first meaningful sentence from narrative
  const sentences = narrative
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .split(/[.。!！?\n]/)
    .map(s => s.trim())
    .filter(s => s.length >= 15);

  if (sentences.length > 0) {
    return { title: sentences[0].slice(0, 60), improved: true };
  }

  return { title, improved: false };
}

/**
 * Resolve entity name against existing Knowledge Graph entities.
 * If a close match is found, use the canonical entity name.
 */
function resolveEntity(
  entityName: string,
  existingEntities: string[],
): { entityName: string; resolved: boolean } {
  if (existingEntities.length === 0) return { entityName, resolved: false };

  const lower = entityName.toLowerCase().replace(/[-_]/g, '');

  for (const existing of existingEntities) {
    const existingLower = existing.toLowerCase().replace(/[-_]/g, '');

    // Exact match (case-insensitive, ignoring hyphens/underscores)
    if (lower === existingLower) {
      return { entityName: existing, resolved: existing !== entityName };
    }

    // Substring match: one contains the other (e.g., "auth" matches "auth-module")
    if (lower.length >= 3 && existingLower.length >= 3) {
      if (existingLower.includes(lower) || lower.includes(existingLower)) {
        // Prefer the longer (more specific) name
        const canonical = existing.length >= entityName.length ? existing : entityName;
        return { entityName: canonical, resolved: canonical !== entityName };
      }
    }
  }

  return { entityName, resolved: false };
}

/**
 * Verify observation type against content signals.
 * If content strongly suggests a different type, correct it.
 */
function verifyType(
  declaredType: ObservationType,
  narrative: string,
  title: string,
): { type: ObservationType; corrected: boolean } {
  const content = `${title} ${narrative}`;

  // Score each type by counting individual keyword hits across all patterns
  const scores: Array<{ type: ObservationType; score: number }> = [];
  for (const { type, patterns } of TYPE_SIGNALS) {
    let score = 0;
    for (const p of patterns) {
      // Use matchAll to count individual keyword matches
      const regex = new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g');
      const matches = [...content.matchAll(regex)];
      score += matches.length;
    }
    if (score > 0) scores.push({ type, score });
  }

  if (scores.length === 0) return { type: declaredType, corrected: false };

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];

  // Only correct if the best match is significantly stronger than declared type
  // Requires: best type has >= 2 keyword hits AND declared type has 0 signals
  if (best.type !== declaredType && best.score >= 2) {
    const declaredScore = scores.find(s => s.type === declaredType)?.score ?? 0;
    if (declaredScore === 0) {
      return { type: best.type, corrected: true };
    }
  }

  return { type: declaredType, corrected: false };
}

// ── LLM Fact Extraction ─────────────────────────────────────────

/** Prompt for LLM-based fact extraction (inspired by Mem0's approach) */
const LLM_EXTRACT_PROMPT = `You are a Software Engineering Knowledge Extractor.
Extract structured facts from the given development context.

Focus on:
1. Technical decisions and their reasoning
2. Bug root causes and fixes
3. Configuration values (ports, versions, env vars)
4. Architecture patterns and constraints
5. Gotchas, pitfalls, and workarounds
6. File paths and their roles

Rules:
- Return ONLY a JSON object with a "facts" key containing an array of strings
- Each fact should be a concise, self-contained statement
- Include specific values (versions, ports, paths) when present
- Detect the language of the input and record facts in the same language
- If no meaningful facts exist, return {"facts": []}
- Do NOT include trivial information (file read, directory listing)
- Maximum 10 facts

Example:
Input: "Fixed Redis connection leak. The pool wasn't being closed on shutdown. Added defer pool.Close() in main.go. Port 6379."
Output: {"facts": ["Redis connection leak caused by pool not closed on shutdown", "Fix: added defer pool.Close() in main.go", "Redis port: 6379"]}`;

/**
 * Extract facts using LLM (Mem0-style structured extraction).
 * Returns extracted facts or empty array on failure.
 */
async function extractFactsWithLLM(
  narrative: string,
  title: string,
  existingFacts: string[],
  signal?: AbortSignal,
): Promise<string[]> {
  try {
    const { callLLM } = await import('../../llm/provider.js');
    const input = `Title: ${title}\nContent: ${narrative}${existingFacts.length > 0 ? `\nAlready known facts (don't repeat): ${existingFacts.join('; ')}` : ''}`;
    const response = await callLLM(LLM_EXTRACT_PROMPT, input, signal);
    const text = response.content.trim();

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    const facts = parsed.facts;
    if (!Array.isArray(facts)) return [];

    // Filter: remove duplicates with existing facts
    const existingLower = new Set(existingFacts.map(f => f.toLowerCase().trim()));
    return facts
      .filter((f: unknown): f is string => typeof f === 'string' && f.length >= 5)
      .filter((f: string) => !existingLower.has(f.toLowerCase().trim()))
      .slice(0, 10);
  } catch (error) {
    if (signal?.aborted) throw error;
    return []; // LLM failure → fall back to rules
  }
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Run Stage 1: Extract.
 *
 * Enriches raw input with system-extracted facts, normalized titles,
 * resolved entities, and verified types.
 *
 * When useLLM=true, uses LLM for fact extraction (Mem0-style).
 * Falls back to rules-based extraction on LLM failure.
 */
export async function runExtract(
  input: FormationInput,
  existingEntities: string[],
  useLLM = false,
  signal?: AbortSignal,
): Promise<ExtractResult> {
  const callerFacts = input.facts ?? [];

  // 1. Extract facts from narrative
  let extractedFacts: string[];
  if (useLLM) {
    // LLM extraction (quality-first, Mem0-style)
    extractedFacts = await extractFactsWithLLM(input.narrative, input.title, callerFacts, signal);
    // If LLM returned nothing, fall back to rules
    if (extractedFacts.length === 0) {
      extractedFacts = extractFacts(input.narrative, callerFacts);
    }
  } else {
    // Rules-based extraction (free mode)
    extractedFacts = extractFacts(input.narrative, callerFacts);
  }
  const allFacts = [...callerFacts, ...extractedFacts];

  // 2. Improve title if generic
  const { title, improved: titleImproved } = improveTitle(input.title, input.narrative);

  // 3. Resolve entity name
  const { entityName, resolved: entityResolved } = resolveEntity(
    input.entityName,
    existingEntities,
  );

  // 4. Verify observation type
  const { type, corrected: typeCorrected } = verifyType(
    input.type,
    input.narrative,
    input.title,
  );

  return {
    title,
    titleImproved,
    narrative: input.narrative,
    facts: allFacts,
    extractedFacts,
    entityName,
    entityResolved,
    type,
    typeCorrected,
  };
}
