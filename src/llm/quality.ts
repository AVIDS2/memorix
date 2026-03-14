/**
 * LLM Quality Enhancements
 *
 * Premium memory quality features powered by LLM:
 * 1. Narrative Compression — compress verbose narratives into concise core knowledge
 * 2. Search Reranking — rerank search results by relevance to current task context
 *
 * Both features gracefully degrade: when LLM is not configured, they return
 * the original data unchanged.
 *
 * Performance targets:
 * - Compression: ~60% token reduction per stored memory
 * - Reranking: ~40% improvement in Top-5 precision
 */

import { callLLM, isLLMEnabled } from './provider.js';

// ── Narrative Compression ────────────────────────────────────────

const COMPRESS_PROMPT = `You are a memory compression engine for a coding assistant.

Compress the given narrative while preserving ALL technical facts and reasoning.

Rules:
- Remove: filler words, debugging journey, repeated info already in facts
- Keep: specific values, file paths, error messages, version numbers, config keys, causal relationships, design reasoning
- Merge related points into dense sentences
- If facts are provided separately, do NOT repeat them in the compressed narrative
- Output the compressed text ONLY, no explanation or wrapper

Examples:
Input: "我在调试过程中发现JWT token的refresh机制存在问题，具体来说是因为服务端没有实现自动续签，导致用户在24小时后会遇到静默的认证失败，之前我一直以为是网络问题但后来排查发现是token过期了"
Output: "JWT refresh无自动续签→24h后静默认证失败（非网络问题）"

Input: "Final deployment model for shadcn-blog is stable: GitHub Actions build locally, SCP artifacts to VPS, systemd manages the process. Docker was considered but rejected due to complexity overhead for a simple blog. The whole pipeline takes about 2 minutes from push to live."
Output: "shadcn-blog部署: GH Actions构建→SCP到VPS→systemd管理, 弃Docker(复杂度过高), push到上线~2min"`;

/** Gentler prompt for high-value types where reasoning context matters */
const COMPRESS_PROMPT_GENTLE = `You are a memory compression engine for a coding assistant.

Lightly compress the given narrative — preserve reasoning, trade-offs, and "why" context.

Rules:
- Only remove: obvious filler, debugging detours, info already in the separate facts list
- PRESERVE: design reasoning, rejected alternatives, trade-off analysis, causal chains
- Aim for ~70-80% of original length, NOT aggressive compression
- If facts are provided separately, do NOT repeat them in the compressed narrative
- Output the compressed text ONLY, no explanation or wrapper`;

/**
 * Compress a narrative to its essential core using LLM.
 *
 * Returns the original narrative if:
 * - LLM is not enabled
 * - Narrative is already short (≤80 chars)
 * - Narrative is already concise (commands, file paths, git operations)
 * - LLM call fails
 */
export async function compressNarrative(
  narrative: string,
  facts?: string[],
  type?: string,
): Promise<{ compressed: string; saved: number; usedLLM: boolean }> {
  const originalTokens = estimateTokens(narrative);

  // Skip compression for short narratives (≤150 chars is already concise)
  if (!isLLMEnabled() || narrative.length <= 150) {
    return { compressed: narrative, saved: 0, usedLLM: false };
  }

  // Skip compression for already-concise content that LLM can't meaningfully compress
  if (shouldSkipCompression(narrative, type)) {
    return { compressed: narrative, saved: 0, usedLLM: false };
  }

  try {
    const factsContext = facts && facts.length > 0
      ? `\n\nSeparate facts (already stored, don't repeat): ${facts.join('; ')}`
      : '';

    // Use gentler compression for high-value types where reasoning matters
    const HIGH_VALUE_TYPES = new Set(['decision', 'trade-off', 'why-it-exists', 'how-it-works']);
    const prompt = (type && HIGH_VALUE_TYPES.has(type)) ? COMPRESS_PROMPT_GENTLE : COMPRESS_PROMPT;
    const response = await callLLM(prompt, narrative + factsContext);
    const compressed = response.content.trim();

    // Sanity check: compressed should be shorter and non-empty
    if (!compressed || compressed.length >= narrative.length) {
      return { compressed: narrative, saved: 0, usedLLM: true };
    }

    const compressedTokens = estimateTokens(compressed);
    return {
      compressed,
      saved: originalTokens - compressedTokens,
      usedLLM: true,
    };
  } catch {
    return { compressed: narrative, saved: 0, usedLLM: false };
  }
}

// ── Search Reranking ─────────────────────────────────────────────

/** Minimal search result for reranking */
export interface RerankCandidate {
  id: number;
  title: string;
  type: string;
  score: number;
  narrative?: string;
}

const RERANK_PROMPT = `You are a memory relevance ranker for a coding assistant.

Given a QUERY (what the user/agent is looking for) and a list of CANDIDATE memories,
rerank them by relevance to the query.

Rules:
- Consider semantic relevance, not just keyword overlap
- Gotchas and decisions related to the query topic should rank higher
- Recent problem-solutions for the same component should rank higher
- Generic or loosely related memories should rank lower
- Output ONLY a JSON array of IDs in order of relevance (most relevant first)
- Include ALL candidate IDs, just reorder them

Example output: [42, 15, 87, 3, 21]`;

/**
 * Rerank search results using LLM contextual understanding.
 *
 * Takes Orama's initial ranking and improves it by considering
 * semantic relevance to the current query/task context.
 *
 * Returns original order if LLM is not enabled or call fails.
 */
export async function rerankResults(
  query: string,
  candidates: RerankCandidate[],
): Promise<{ reranked: RerankCandidate[]; usedLLM: boolean }> {
  // Skip if too few results or LLM not available
  if (!isLLMEnabled() || candidates.length <= 2) {
    return { reranked: candidates, usedLLM: false };
  }

  // Only rerank top-N to save LLM tokens (reranking 20+ is wasteful)
  const MAX_RERANK = 10;
  const toRerank = candidates.slice(0, MAX_RERANK);
  const rest = candidates.slice(MAX_RERANK);

  try {
    const candidateList = toRerank.map(c =>
      `[ID: ${c.id}] (${c.type}) ${c.title}${c.narrative ? ` — ${c.narrative.substring(0, 100)}` : ''}`,
    ).join('\n');

    const response = await callLLM(RERANK_PROMPT, `QUERY: ${query}\n\nCANDIDATES:\n${candidateList}`);

    // Parse response — handle markdown code blocks
    let content = response.content.trim();
    if (content.startsWith('```')) {
      content = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    const rankedIds = JSON.parse(content) as number[];

    // Validate: must be an array of numbers matching our candidates
    if (!Array.isArray(rankedIds) || rankedIds.length === 0) {
      return { reranked: candidates, usedLLM: true };
    }

    // Build reranked list preserving original scores for display
    const idMap = new Map(toRerank.map(c => [c.id, c]));
    const reranked: RerankCandidate[] = [];
    const seen = new Set<number>();

    // Add IDs in LLM-reranked order
    for (const id of rankedIds) {
      const candidate = idMap.get(id);
      if (candidate && !seen.has(id)) {
        reranked.push(candidate);
        seen.add(id);
      }
    }

    // Add any candidates the LLM missed (safety: never lose results)
    for (const c of toRerank) {
      if (!seen.has(c.id)) {
        reranked.push(c);
      }
    }

    // Append non-reranked tail
    reranked.push(...rest);

    return { reranked, usedLLM: true };
  } catch {
    return { reranked: candidates, usedLLM: false };
  }
}

// ── Smart Compression Filtering ──────────────────────────────────

/** Patterns that indicate already-concise content not worth compressing */
const SKIP_PATTERNS = [
  /^(?:Command|Run|Execute):\s/i,           // Shell commands
  /^(?:File|Edit|Changed):\s/i,             // File change descriptions
  /^git\s+(?:add|commit|push|pull|log)/i,   // Git operations
  /^(?:npm|npx|pnpm|yarn|bun)\s/i,          // Package manager commands
  /^(?:Remove-Item|New-Item|Set-Content)/i,  // PowerShell commands
  /^[A-Za-z]:\\[\w\\]/,                      // Windows file paths
  /^\/(?:usr|home|var|etc|opt)\//,           // Unix file paths
];

/** Low-value observation types that hooks auto-capture (usually already terse) */
const LOW_COMPRESSION_TYPES = new Set(['what-changed', 'discovery', 'session-request']);

/**
 * Determine if a narrative should skip LLM compression.
 *
 * Skip when:
 * - Content starts with command/path patterns (already structured, not prose)
 * - Type is hooks-auto-captured AND narrative is relatively short
 * - Narrative is mostly code/paths (high ratio of special chars)
 */
function shouldSkipCompression(narrative: string, type?: string): boolean {
  // Skip command/path-like content
  const firstLine = narrative.split('\n')[0];
  if (SKIP_PATTERNS.some(p => p.test(firstLine))) return true;

  // Skip short auto-captured observations (hooks produce terse what-changed)
  if (type && LOW_COMPRESSION_TYPES.has(type) && narrative.length < 200) return true;

  // Skip if narrative is mostly code/structured data (high special char ratio)
  const specialChars = (narrative.match(/[{}()\[\]<>:;=|\\\/\-_\.@#$%^&*+~`"']/g) || []).length;
  if (specialChars / narrative.length > 0.35) return true;

  return false;
}

// ── Utility ──────────────────────────────────────────────────────

/** Rough token estimate: ~4 chars per token for English, ~2 for CJK */
function estimateTokens(text: string): number {
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
  const otherChars = text.length - cjkChars;
  return Math.ceil(cjkChars / 1.5 + otherChars / 4);
}
