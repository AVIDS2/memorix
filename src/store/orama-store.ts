/**
 * Orama Store
 *
 * Full-text + vector + hybrid search engine backed by Orama.
 * Source: @orama/orama (10.1K stars, <2KB, pure JS, zero deps)
 *
 * Schema designed to store Observations with all searchable fields.
 * Vector search (embeddings) will be added in P1 phase.
 */

import { create, insert, search, remove, update, count, type AnyOrama } from '@orama/orama';
import type { MemorixDocument, SearchOptions, IndexEntry, KnowledgeLayer } from '../types.js';
import { OBSERVATION_ICONS, type ObservationType } from '../types.js';
import { resolveKnowledgeLayer } from '../skills/mini-skills.js';
import { getEmbeddingProvider, type EmbeddingProvider } from '../embedding/provider.js';
import { calculateProjectAffinity, extractProjectKeywords, type AffinityContext, type MemoryContent } from './project-affinity.js';
import { detectQueryIntent, applyIntentBoost } from '../search/intent-detector.js';
import { maybeExpandSearchQuery } from '../search/query-expansion.js';

let db: AnyOrama | null = null;
let embeddingEnabled = false;
let embeddingDimensions: number | null = null;
const NON_CJK_HYBRID_SIMILARITY = 0.45;
const lastSearchModeByProject = new Map<string, string>();
const SEARCH_MODE_DEFAULT_KEY = '__global__';
export function getLastSearchMode(projectId?: string): string {
  return lastSearchModeByProject.get(projectId ?? SEARCH_MODE_DEFAULT_KEY) ?? 'fulltext';
}
// Hard filter: titles starting with these are command execution logs, not knowledge.
// They are excluded from results entirely (not just demoted) unless the query is command-like.
const COMMAND_LOG_TITLE = /^(Ran:|Command:|Executed:)\s/i;
// Soft demotion: titles containing shell-specific patterns get a score penalty.
const COMMAND_STYLE_TITLE = /(\bfindstr\b|\bSelect-String\b|\bGet-Content\b|\bnpx\s+vitest\b|\bnpx\s+tsc\b|\b2>&1\b)/i;
const COMMAND_LIKE_QUERY = /\b(git|npm|npx|pnpm|yarn|node|bash|powershell|curl|memorix)\b/i;
// Stricter pattern: query IS a command (tool word at start, e.g. "git status", "npm install").
// Does NOT match natural language like "why is memorix search slow".
const COMMAND_INTENT_QUERY = /^\s*(git|npm|npx|pnpm|yarn|node|bash|powershell|curl|memorix)\s/i;
// Natural language markers — if ANY of these appear in the query, it is NOT a pure command.
// Covers: question words, problem descriptors, reasoning words.
const NATURAL_LANGUAGE_MARKERS = /\b(why|how|what|where|when|does|did|is|are|was|will|can|should|would|slow|fast|fail|error|bug|broken|issue|problem|wrong|crash|fix|work|performance|cause|reason|explain|understand)\b/i;

/**
 * Build a globally unique Orama document ID for an observation.
 * observationId is only unique within a project, so projectId must be included.
 */
export function makeOramaObservationId(projectId: string, observationId: number): string {
  return `obs-${encodeURIComponent(projectId)}-${observationId}`;
}

function makeEntryKey(projectId: string | undefined, observationId: number): string {
  return `${projectId ?? ''}::${observationId}`;
}

function isCommandLikeQuery(query: string): boolean {
  return COMMAND_LIKE_QUERY.test(query);
}

/**
 * Resolve the effective source label for intent-boost purposes.
 * Phase 1 introduced sourceDetail='git-ingest' as a more precise signal than
 * source='git'. Treat them as equivalent so intent-based source boosts
 * (e.g. what_changed → git: 2.0) apply to both representations.
 * Used in the source-aware retrieval path only — not stored or exported.
 */
function effectiveSource(
  source: 'agent' | 'git' | 'manual',
  sourceDetail?: 'explicit' | 'hook' | 'git-ingest',
): 'agent' | 'git' | 'manual' {
  return sourceDetail === 'git-ingest' ? 'git' : source;
}

/** True when the query IS a command (tool word leads), not just mentioning a tool. */
function isCommandIntentQuery(query: string): boolean {
  if (!COMMAND_INTENT_QUERY.test(query)) return false;
  // If the query contains natural language markers (question words, problem
  // descriptors), it is a human question about a tool, not a CLI invocation.
  if (NATURAL_LANGUAGE_MARKERS.test(query)) return false;
  return true;
}

/** @internal Exported for testing only. */
export { classifyQueryTier as _classifyQueryTier };

/**
 * Query tier classification for performance-aware search.
 * - 'fast':     short/exact/command queries → fulltext only, no embedding, no rerank
 * - 'standard': normal queries → fulltext + embedding, no rerank
 * - 'heavy':    CJK or long ambiguous queries → expansion + embedding + rerank
 */
type QueryTier = 'fast' | 'standard' | 'heavy';

function classifyQueryTier(query: string): QueryTier {
  if (!query || query.trim().length === 0) return 'fast';
  // CJK-heavy queries must be checked FIRST — CJK text has no word-separating
  // spaces, so word-count heuristics would misclassify them as "fast".
  const cjkCount = (query.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
  if (cjkCount / query.length > 0.3) return 'heavy';
  // Single-word or very short queries: fast path
  const words = query.trim().split(/\s+/);
  if (words.length <= 1 && query.length <= 20) return 'fast';
  // Command-intent queries: fast path ("git status", "npm install")
  // NOT triggered by natural language mentioning a tool ("why is memorix search slow")
  if (isCommandIntentQuery(query)) return 'fast';
  // Long multi-word queries: heavy path
  if (words.length >= 5) return 'heavy';
  // Everything else: standard
  return 'standard';
}

function isCommandLogEntry(title: string): boolean {
  return COMMAND_LOG_TITLE.test(title);
}

function isCommandStyleEntry(title: string): boolean {
  return COMMAND_STYLE_TITLE.test(title);
}

function isVectorDimensionMismatchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    /declared as a \d+-dimensional vector, but got a \d+-dimensional vector/i.test(error.message) ||
    /dimension mismatch/i.test(error.message)
  );
}

function stripVectorSearchParams(params: Record<string, unknown>): Record<string, unknown> {
  const { mode, vector, similarity, hybridWeights, ...rest } = params;
  return rest;
}

/**
 * Initialize or return the Orama database instance.
 * Schema conditionally includes vector field based on embedding provider.
 * Graceful degradation: no provider → fulltext only, provider → hybrid.
 */
export async function getDb(): Promise<AnyOrama> {
  if (db) return db;

  // Check if embedding provider is available
  const provider = await getEmbeddingProvider();
  embeddingEnabled = provider !== null;
  embeddingDimensions = provider?.dimensions ?? null;

  const baseSchema = {
    id: 'string' as const,
    observationId: 'number' as const,
    entityName: 'string' as const,
    type: 'string' as const,
    title: 'string' as const,
    narrative: 'string' as const,
    facts: 'string' as const,
    filesModified: 'string' as const,
    concepts: 'string' as const,
    tokens: 'number' as const,
    createdAt: 'string' as const,
    projectId: 'string' as const,
    accessCount: 'number' as const,
    lastAccessedAt: 'string' as const,
    status: 'string' as const,
    source: 'string' as const,
    sourceDetail: 'string' as const,
    valueCategory: 'string' as const,
    documentType: 'string' as const,
    knowledgeLayer: 'string' as const,
  };

  // Dynamic vector dimensions based on provider (384 for local, 1024+ for API)
  const dims = embeddingDimensions ?? 384;
  const schema = embeddingEnabled
    ? { ...baseSchema, embedding: `vector[${dims}]` as const }
    : baseSchema;

  db = await create({ schema });

  return db;
}

/**
 * Reset the database instance (useful for testing).
 */
export async function resetDb(): Promise<void> {
  db = null;
  embeddingEnabled = false;
  embeddingDimensions = null;
  lastSearchModeByProject.clear();
}

/**
 * Check if embedding/vector search is active.
 */
export function isEmbeddingEnabled(): boolean {
  return embeddingEnabled;
}

/**
 * Current vector dimensions for the active Orama index.
 * Returns null when vector search is disabled for this process.
 */
export function getVectorDimensions(): number | null {
  return embeddingEnabled ? embeddingDimensions : null;
}

/**
 * Generate embedding for text content using the available provider.
 * Returns null if no provider is available.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const provider = await getEmbeddingProvider();
  if (!provider) return null;
  return provider.embed(text);
}

/**
 * Batch-generate embeddings for multiple texts.
 * Much faster than individual calls — ONNX processes batches of 64 in parallel.
 * Returns null entries for texts that fail.
 */
export async function batchGenerateEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
  const provider = await getEmbeddingProvider();
  if (!provider || texts.length === 0) return texts.map(() => null);
  try {
    const results = await provider.embedBatch(texts);
    return results;
  } catch (error) {
    console.error(
      `[memorix] Batch embedding failed, falling back to null vectors: ${error instanceof Error ? error.message : error}`,
    );
    return texts.map(() => null);
  }
}

/**
 * Hydrate the Orama index from persisted observations.
 * Must be called before searching if the index was freshly created (TUI / CLI startup).
 * Skips observations already in the index (idempotent).
 */
export async function hydrateIndex(observations: any[]): Promise<number> {
  const database = await getDb();
  const currentCount = await count(database);
  if (currentCount > 0) return 0; // already hydrated

  let inserted = 0;
  for (const obs of observations) {
    if (!obs || !obs.id || !obs.projectId) continue;
    try {
      const doc: MemorixDocument = {
        id: makeOramaObservationId(obs.projectId, obs.id),
        observationId: obs.id,
        entityName: obs.entityName || '',
        type: obs.type || 'discovery',
        title: obs.title || '',
        narrative: obs.narrative || '',
        facts: Array.isArray(obs.facts) ? obs.facts.join(' ') : '',
        filesModified: Array.isArray(obs.filesModified) ? obs.filesModified.join(' ') : '',
        concepts: Array.isArray(obs.concepts) ? obs.concepts.join(' ') : '',
        tokens: obs.tokens ?? 0,
        createdAt: obs.createdAt || '',
        projectId: obs.projectId,
        accessCount: obs.accessCount ?? 0,
        lastAccessedAt: obs.lastAccessedAt || '',
        status: obs.status ?? 'active',
        source: obs.source || 'agent',
        documentType: 'observation',
        knowledgeLayer: resolveKnowledgeLayer('observation', obs.sourceDetail, obs.source),
      };
      await insert(database, doc);
      inserted++;
    } catch { /* skip malformed entries */ }
  }
  return inserted;
}

/**
 * Insert an observation document into the store.
 */
export async function insertObservation(doc: MemorixDocument): Promise<void> {
  const database = await getDb();
  await insert(database, doc);
}

/**
 * Remove an observation document by its Orama internal ID.
 */
export async function removeObservation(oramaId: string): Promise<void> {
  const database = await getDb();
  await remove(database, oramaId);
}

/**
 * Search observations using Orama full-text search.
 * Returns L1 IndexEntry array (compact, ~50-100 tokens per result).
 *
 * Progressive Disclosure Layer 1 — adopted from claude-mem.
 */
export async function searchObservations(options: SearchOptions): Promise<IndexEntry[]> {
  const perf = !!process.env.MEMORIX_PERF;
  const t0 = perf ? performance.now() : 0;
  const mark = (label: string) => { if (perf) { const now = performance.now(); process.stderr.write(`  [search-perf] ${label}: ${(now - t0).toFixed(0)}ms\n`); } };
  const modeKey = options.projectId ?? SEARCH_MODE_DEFAULT_KEY;
  lastSearchModeByProject.set(modeKey, embeddingEnabled ? 'hybrid' : 'fulltext');
  const database = await getDb();

  // Resolve project aliases — safety net for observations not yet migrated to canonical ID.
  // After migration, this is typically a single-element array matching options.projectId.
  let projectIds: string[] | null = null;
  if (options.projectId) {
    try {
      const { resolveAliases } = await import('../project/aliases.js');
      projectIds = await resolveAliases(options.projectId);
    } catch {
      projectIds = [options.projectId];
    }
  }

  const filters: Record<string, unknown> = {};
  if (projectIds && projectIds.length === 1) {
    filters['projectId'] = projectIds[0];
  }
  // If multiple aliases exist, we skip the Orama projectId filter and post-filter instead
  if (options.type) {
    filters['type'] = options.type;
  }
  if (options.source) {
    filters['source'] = options.source;
  }

  // Determine search mode: hybrid (with vector) or fulltext (default)
  const hasQuery = options.query && options.query.trim().length > 0;
  const originalQuery = options.query;
  const tier = hasQuery ? classifyQueryTier(originalQuery!) : 'fast' as QueryTier;
  mark(`tier=${tier}`);

  // Query expansion: only for heavy-tier (CJK) queries
  const expandedEmbeddingQuery = tier === 'heavy' ? await maybeExpandSearchQuery(options.query!) : options.query;
  mark('queryExpansion');

  // ── Intent-Aware Recall ──────────────────────────────────────
  // Detect query intent (why/when/how/what/problem) and adjust
  // field weights and type boosting accordingly.
  const intentResult = hasQuery ? detectQueryIntent(originalQuery!) : null;

  // Orama's vector/hybrid search can leak cross-project hits even when `where`
  // is present, so always keep enough headroom for a deterministic post-filter.
  const requestLimit = projectIds
    ? (options.limit ?? 20) * 3
    : (options.limit ?? 20);

  // Default field boosts — overridden by intent-specific boosts when detected
  const defaultBoost: Record<string, number> = {
    title: 3,
    entityName: 2,
    concepts: 1.5,
    narrative: 1,
    facts: 1,
    filesModified: 0.5,
  };
  const fieldBoost = (intentResult?.confidence ?? 0) > 0.3 && intentResult?.fieldBoosts
    ? intentResult.fieldBoosts
    : defaultBoost;

  let searchParams: Record<string, unknown> = {
    term: originalQuery,
    limit: requestLimit,
    ...(Object.keys(filters).length > 0 ? { where: filters } : {}),
    // Search specific fields (not tokens, accessCount, etc.)
    properties: ['title', 'entityName', 'narrative', 'facts', 'concepts', 'filesModified'],
    // Field boosting: intent-aware or default
    boost: fieldBoost,
    // Fuzzy tolerance: allow 1-char typos for short queries, 2 for longer
    ...(hasQuery ? { tolerance: originalQuery!.length > 6 ? 2 : 1 } : {}),
  };

  // If embedding provider is available and query tier warrants it, use hybrid search
  // Fast-tier queries skip embedding entirely (fulltext is sufficient)
  let queryVector: number[] | null = null;
  if (embeddingEnabled && hasQuery && tier !== 'fast') {
    try {
      const provider = await getEmbeddingProvider();
      if (provider) {
        const activeVectorDimensions = getVectorDimensions();
        if (activeVectorDimensions !== null && provider.dimensions !== activeVectorDimensions) {
          lastSearchModeByProject.set(
            modeKey,
            `fulltext (embedding dimension mismatch: provider ${provider.dimensions}d vs index ${activeVectorDimensions}d)`,
          );
          console.error(
            `[memorix] Embedding provider dimension mismatch (${provider.dimensions}d provider vs ${activeVectorDimensions}d index); using fulltext search`,
          );
        } else {
          // Embedding timeout: 15 seconds
          const EMBEDDING_TIMEOUT_MS = 15000;
          const embedPromise = provider.embed(expandedEmbeddingQuery!);
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Embedding timeout after ${EMBEDDING_TIMEOUT_MS}ms`)), EMBEDDING_TIMEOUT_MS)
          );
          queryVector = await Promise.race([embedPromise, timeoutPromise]);
          mark('embedding');
          // Detect CJK-heavy queries: BM25 can't tokenize Chinese/Japanese/Korean well
          const cjkRatio = (originalQuery!.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length / originalQuery!.length;
          const isCJKHeavy = cjkRatio > 0.3;
          lastSearchModeByProject.set(modeKey, 'hybrid');
          searchParams = {
            ...searchParams,
            mode: 'hybrid',
            vector: {
              value: queryVector,
              property: 'embedding',
            },
            // English paraphrase queries were getting clipped just below 0.5
            // even when vector-only search could already find the right memory.
            similarity: isCJKHeavy ? 0.3 : NON_CJK_HYBRID_SIMILARITY,
            hybridWeights: isCJKHeavy
              ? { text: 0.2, vector: 0.8 }  // CJK: trust vector over BM25
              : { text: 0.6, vector: 0.4 },
          };
        }
      }
    } catch (error) {
      // Fallback to fulltext if embedding fails or times out
      lastSearchModeByProject.set(modeKey, 'fulltext (embedding unavailable)');
      console.error('[memorix] Embedding failed or timed out, falling back to fulltext search');
    }
  }

  mark('preSearch');
  let results;
  try {
    results = await search(database, searchParams);
  } catch (error) {
    if (queryVector && isVectorDimensionMismatchError(error)) {
      lastSearchModeByProject.set(modeKey, 'fulltext (embedding dimension mismatch)');
      console.error('[memorix] Vector search dimension mismatch detected, retrying without embeddings');
      results = await search(database, stripVectorSearchParams(searchParams));
    } else {
      throw error;
    }
  }
  mark('oramaSearch');

  // Fallback: if hybrid returned nothing but we have a vector, retry with vector-only
  if (results.count === 0 && queryVector && embeddingEnabled) {
    try {
      const vectorOnlyParams: Record<string, unknown> = {
        term: '',
        limit: requestLimit,
        ...(Object.keys(filters).length > 0 ? { where: filters } : {}),
        mode: 'vector',
        vector: {
          value: queryVector,
          property: 'embedding',
        },
        similarity: 0.25,
      };
      lastSearchModeByProject.set(modeKey, 'vector-only (hybrid empty fallback)');
      results = await search(database, vectorOnlyParams);
    } catch {
      // Keep original empty results
    }
  }

  // Status filter: default to 'active' only
  const statusFilter = options.status ?? 'active';

  // Build intermediate results with rawTime for temporal filtering
  let intermediate = results.hits
    // Always post-filter by projectIds. Vector/hybrid search can leak hits even when
    // the `where` clause is present, so this keeps project isolation deterministic.
    .filter((hit) => {
      if (!projectIds) return true;
      const doc = hit.document as unknown as MemorixDocument;
      return projectIds.includes(doc.projectId);
    })
    // Post-filter by status (active/resolved/archived)
    .filter((hit) => {
      if (statusFilter === 'all') return true;
      const doc = hit.document as unknown as MemorixDocument;
      return (doc.status || 'active') === statusFilter;
    })
    .map((hit) => {
      const doc = hit.document as unknown as MemorixDocument;
      const obsType = doc.type as ObservationType;
      // Time decay: newer memories get higher boost
      const ageMs = Date.now() - new Date(doc.createdAt).getTime();
      const DAY = 86_400_000;
      let recencyBoost: number;
      if (ageMs < 1 * DAY) recencyBoost = 1.0;
      else if (ageMs < 7 * DAY) recencyBoost = 0.85;
      else if (ageMs < 30 * DAY) recencyBoost = 0.6;
      else recencyBoost = 0.35;

      return {
        id: doc.observationId,
        time: formatTime(doc.createdAt),
        rawTime: doc.createdAt,
        type: obsType,
        icon: OBSERVATION_ICONS[obsType] ?? '❓',
        title: doc.title,
        tokens: doc.tokens,
        score: (hit.score ?? 1) * recencyBoost,
        projectId: doc.projectId,
        source: (doc.source || 'agent') as 'agent' | 'git' | 'manual',
        sourceDetail: (doc.sourceDetail || undefined) as 'explicit' | 'hook' | 'git-ingest' | undefined,
        valueCategory: (doc.valueCategory || undefined) as 'core' | 'contextual' | 'ephemeral' | undefined,
        entityName: doc.entityName || undefined,
        documentType: (doc.documentType || 'observation') as 'observation' | 'mini-skill',
        knowledgeLayer: (doc.knowledgeLayer || 'project-truth') as KnowledgeLayer,
        _isCommandLog: isCommandLogEntry(doc.title),
      };
    });

  // ── Knowledge-Layer Boost (Phase 3a, step 3) ─────────────────
  // Explicit layer-aware ranking: promoted knowledge gets a mild boost
  // for general queries, evidence gets a boost for evidence-seeking queries.
  // This is the dedicated layer signal — NOT borrowed from valueCategory.
  {
    const isEvidenceSeeking = intentResult?.intent === 'what_changed' ||
      (hasQuery && /\b(evidence|verify|proof|git|commit)\b/i.test(originalQuery!));
    const layerBoosts: Record<string, number> = isEvidenceSeeking
      ? { promoted: 1.10, 'project-truth': 1.00, evidence: 1.15 }
      : { promoted: 1.20, 'project-truth': 1.00, evidence: 0.90 };
    intermediate = intermediate.map(entry => ({
      ...entry,
      score: entry.score * (layerBoosts[(entry as any).knowledgeLayer] ?? 1.0),
    }));
  }

  // ── Intent-Aware Type Boosting ───────────────────────────────
  // Boost scores for observation types that match the query intent
  if (intentResult && intentResult.confidence > 0.3) {
    intermediate = intermediate.map(entry => ({
      ...entry,
      score: applyIntentBoost(entry.score, entry.type, intentResult),
    }));
  }

  // ── Source-Aware Retrieval ─────────────────────────────────────
  // Boost scores based on memory source matching query intent.
  // e.g., "what changed" queries boost git-derived memories,
  //        "why" queries boost agent-authored reasoning memories.
  if (intentResult && intentResult.confidence > 0.3 && intentResult.sourceBoosts) {
    const srcBoosts = intentResult.sourceBoosts;
    intermediate = intermediate.map(entry => {
      const boost = srcBoosts[effectiveSource(entry.source, entry.sourceDetail)] ?? 1.0;
      const effectiveBoost = 1 + (boost - 1) * intentResult.confidence;
      return { ...entry, score: entry.score * effectiveBoost };
    });
  }

  // ── Command-log noise suppression (two-pass) ────────────────
  // 73% of observations are Ran:/Command:/Executed: hook logs.  When the query
  // is NOT command-like, we first try excluding them entirely.  If that would
  // leave 0 real results (the query only matched command logs), we fall back to
  // keeping them with a very aggressive 0.05x demotion so SOMETHING is returned
  // but noise never dominates when real results exist.
  if (hasQuery && !isCommandLikeQuery(originalQuery!)) {
    const nonCommandEntries = intermediate.filter(e => !(e as any)._isCommandLog);
    if (nonCommandEntries.length > 0) {
      // Enough real results — drop command logs entirely
      intermediate = nonCommandEntries;
    } else {
      // Only command logs matched — keep them but demote heavily
      intermediate = intermediate.map(entry => ({
        ...entry,
        score: (entry as any)._isCommandLog ? entry.score * 0.05 : entry.score,
      }));
    }
    // Also soft-demote shell-specific patterns in remaining results
    intermediate = intermediate.map(entry => ({
      ...entry,
      score: isCommandStyleEntry(entry.title) ? entry.score * 0.3 : entry.score,
    }));
  }

  // Re-sort: chronological for WHEN queries, relevance for others
  if (intentResult?.preferChronological) {
    intermediate.sort((a, b) => new Date(b.rawTime).getTime() - new Date(a.rawTime).getTime());
  } else {
    intermediate.sort((a, b) => b.score - a.score);
  }

  // ─── Project Affinity Scoring (mcp-memory-service style) ───
  // Penalize memories that don't reference the current project to prevent
  // cross-project pollution (e.g., discussing Memorix in a test project workspace)
  if (options.projectId && intermediate.length > 0) {
    const projectName = options.projectId.split('/').pop() ?? options.projectId;
    const affinityContext: AffinityContext = {
      projectName,
      projectId: options.projectId,
      projectKeywords: extractProjectKeywords(projectName, options.projectId),
    };

    // Build a map of memory content for affinity calculation
    const memoryContentMap = new Map<number, MemoryContent>();
    for (const hit of results.hits) {
      const doc = hit.document as unknown as MemorixDocument;
      memoryContentMap.set(doc.observationId, {
        title: doc.title,
        narrative: doc.narrative,
        facts: doc.facts?.split?.('\n') ?? (Array.isArray(doc.facts) ? doc.facts : []),
        concepts: doc.concepts?.split?.('\n') ?? (Array.isArray(doc.concepts) ? doc.concepts : []),
        entityName: doc.entityName,
        filesModified: doc.filesModified?.split?.('\n') ?? (Array.isArray(doc.filesModified) ? doc.filesModified : []),
      });
    }

    // Apply affinity scoring to each result
    intermediate = intermediate.map(entry => {
      const memory = memoryContentMap.get(entry.id);
      if (!memory) return entry;

      const { score: affinityScore } = calculateProjectAffinity(memory, affinityContext);
      return {
        ...entry,
        score: entry.score * affinityScore, // Apply affinity as multiplier
      };
    });

    // Re-sort after affinity adjustment
    intermediate.sort((a, b) => b.score - a.score);
  }

  // Temporal filtering: since/until date range
  if (options.since) {
    const sinceDate = new Date(options.since).getTime();
    intermediate = intermediate.filter(e => new Date(e.rawTime).getTime() >= sinceDate);
  }
  if (options.until) {
    const untilDate = new Date(options.until).getTime();
    intermediate = intermediate.filter(e => new Date(e.rawTime).getTime() <= untilDate);
  }

  // Apply original limit after post-filtering (we intentionally over-requested when project filtering is active)
  if (projectIds) {
    intermediate = intermediate.slice(0, options.limit ?? 20);
  }

  // ── Provenance Tiebreaker (standard tier only) ──────────────────
  // When Orama scores converge — a common outcome in standard-tier queries
  // where both fulltext and embedding are used — this pass gives a tiny
  // preference to repository-backed and core memories within the top-K
  // results whose scores fall within a 20% window of the highest score.
  // Amplitudes are intentionally small: the tiebreaker must never reverse
  // a meaningful score gap, only resolve genuine ambiguity.
  //   git-ingest / source=git  → ×1.06 (repository evidence)
  //   valueCategory=core       → ×1.03 (explicitly classified durable memory)
  // Constraints:
  //   - Standard tier only (fast has no ambiguity; heavy has LLM rerank)
  //   - Top-8 results only (doesn't affect long tail)
  //   - 20% score window from top score (score ≥ topScore × 0.80)
  if (tier === 'standard' && intermediate.length > 1) {
    const TIEBREAK_TOP_K = 8;
    const TIEBREAK_WINDOW = 0.20;
    const topScore = intermediate[0]?.score ?? 0;
    const threshold = topScore * (1 - TIEBREAK_WINDOW);
    let changed = false;
    for (let i = 0; i < Math.min(TIEBREAK_TOP_K, intermediate.length); i++) {
      const entry = intermediate[i];
      if (entry.score < threshold) break; // outside tiebreak window, stop
      const isGitEvidence = effectiveSource(entry.source, entry.sourceDetail) === 'git';
      const isCore = entry.valueCategory === 'core';
      if (isGitEvidence) {
        intermediate[i] = { ...entry, score: entry.score * 1.06 };
        changed = true;
      } else if (isCore) {
        intermediate[i] = { ...entry, score: entry.score * 1.03 };
        changed = true;
      }
    }
    if (changed) intermediate.sort((a, b) => b.score - a.score);
  }

  // ── Entity-affinity hint (standard + heavy tier only) ──────────────
  // When query tokens (4+ chars) match some entity names in results but not
  // others, mildly boost the matching entities (×1.08). This helps queries
  // like "blog VPS deployment" surface blog-vps observations over api-relay
  // observations stored in the same project bucket.
  // Gates:
  //   - standard or heavy tier only (fast tier is single-word, too noisy)
  //   - only fires when some but not all entity names match the query
  //   - top-8 and within the 20% window of the top score
  //   - cannot reverse a meaningful score gap (amplitude ×1.08)
  if ((tier === 'standard' || tier === 'heavy') && intermediate.length > 1 && hasQuery) {
    const affTokens = originalQuery!
      .toLowerCase()
      .split(/\s+/)
      .map(t => t.replace(/[_-]/g, ''))
      .filter(t => t.length >= 4);

    if (affTokens.length > 0) {
      const entityNames = [...new Set(intermediate.map(e => e.entityName).filter((n): n is string => !!n))];
      const matchedEntities = new Set(
        entityNames.filter(name => {
          const norm = name.toLowerCase().replace(/[_-]/g, '');
          return affTokens.some(t => norm.includes(t));
        }),
      );

      if (matchedEntities.size > 0 && matchedEntities.size < entityNames.length) {
        const AFF_TOP_K = 8;
        const AFF_WINDOW = 0.20;
        const AFF_BOOST = 1.08;
        const topScore = intermediate[0]?.score ?? 0;
        const threshold = topScore * (1 - AFF_WINDOW);
        let affChanged = false;
        for (let i = 0; i < Math.min(AFF_TOP_K, intermediate.length); i++) {
          const entry = intermediate[i];
          if (entry.score < threshold) break;
          if (matchedEntities.has(entry.entityName ?? '')) {
            intermediate[i] = { ...entry, score: entry.score * AFF_BOOST };
            affChanged = true;
          }
        }
        if (affChanged) intermediate.sort((a, b) => b.score - a.score);
      }
    }
  }

  // ── LLM Reranking (heavy-tier only) ────────────────────────────
  // Only triggered for heavy-tier queries with ambiguous top results.
  // Fast and standard tiers skip entirely.
  // Ambiguity check: top-2 scores within 30% → results are uncertain.
  const shouldRerank = tier === 'heavy'
    && hasQuery
    && intermediate.length > 2
    && (() => {
      const top = intermediate[0]?.score ?? 0;
      const second = intermediate[1]?.score ?? 0;
      return top > 0 && second / top > 0.7; // top-2 within 30% = ambiguous
    })();

  if (shouldRerank) {
    try {
      const { rerankResults } = await import('../llm/quality.js');
      const narrativeMap = new Map<string, string>();
      for (const hit of results.hits) {
        const doc = hit.document as unknown as MemorixDocument;
        narrativeMap.set(makeEntryKey(doc.projectId, doc.observationId), doc.narrative);
      }
      // Rerank only top-5 (was 10) to save LLM tokens and latency
      const RERANK_TOP_K = 5;
      const toRerank = intermediate.slice(0, RERANK_TOP_K);
      const candidates = toRerank.map((e, index) => ({
        id: `r${index + 1}`,
        title: e.title,
        type: e.type,
        score: e.score,
        narrative: narrativeMap.get(makeEntryKey(e.projectId, e.id)),
      }));
      
      // LLM rerank timeout: 5 seconds (was 10s)
      const RERANK_TIMEOUT_MS = 5000;
      const rerankPromise = rerankResults(originalQuery!, candidates);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`LLM rerank timeout after ${RERANK_TIMEOUT_MS}ms`)), RERANK_TIMEOUT_MS)
      );
      const { reranked, usedLLM } = await Promise.race([rerankPromise, timeoutPromise]);
      mark(`rerank(usedLLM=${usedLLM})`);
      
      if (usedLLM) {
        lastSearchModeByProject.set(modeKey, (lastSearchModeByProject.get(modeKey) ?? 'fulltext') + ' + LLM rerank');
        const candidateMap = new Map(candidates.map((candidate, index) => [candidate.id, toRerank[index]]));
        const rerankedTop = reranked
          .map(r => candidateMap.get(r.id))
          .filter((e): e is NonNullable<typeof e> => e != null);
        if (rerankedTop.length > 0) {
          intermediate = [...rerankedTop, ...intermediate.slice(RERANK_TOP_K)];
        }
      }
    } catch (error) {
      // Reranking is best-effort: fall back to original order on timeout or error
      console.error('[memorix] LLM rerank failed or timed out, using original order');
    }
  } else {
    mark(`rerank(skipped,tier=${tier})`);
  }

  // Build IndexEntry with optional match explanation
  let entries: IndexEntry[] = intermediate.map(({ rawTime: _, _isCommandLog: _c, ...rest }: any) => rest);

  // Explainable recall: annotate entries with match reasons (O(1) lookup via Map)
  if (hasQuery && originalQuery) {
    const queryLower = originalQuery.toLowerCase();
    const queryTokens = queryLower.split(/\s+/).filter(t => t.length > 1);
    const entryMap = new Map(entries.map(e => [makeEntryKey(e.projectId, e.id), e]));
    for (const hit of results.hits) {
      const doc = hit.document as unknown as MemorixDocument;
      const entry = entryMap.get(makeEntryKey(doc.projectId, doc.observationId));
      if (!entry) continue;

      const reasons: string[] = [];
      const fields: [string, string][] = [
        ['title', doc.title], ['entity', doc.entityName], ['concept', doc.concepts],
        ['narrative', doc.narrative], ['fact', doc.facts], ['file', doc.filesModified],
      ];
      for (const [name, value] of fields) {
        const valueLower = value.toLowerCase();
        if (queryTokens.some(t => valueLower.includes(t))) reasons.push(name);
      }
      if (reasons.length === 0) reasons.push('fuzzy');

      // Prepend a single evidence-type tag (max 1) ahead of field-match labels.
      // Priority: git evidence > synthesized > ★ core
      // This surfaces WHY this result is notable beyond the query match.
      const isGitEvidence = doc.sourceDetail === 'git-ingest' || doc.source === 'git';
      const isSynthesized = doc.sourceDetail === 'explicit' &&
        // Note: relatedCommits not in MemorixDocument; flag is best-effort from sourceDetail alone.
        // Full synthesized detection is handled in the detail/timeline path where we have the full obs.
        false; // reserved — set explicitly if MemorixDocument gains relatedCommits in future
      const isCore = doc.valueCategory === 'core';

      if (isGitEvidence) {
        entry.matchedFields = ['git evidence', ...reasons];
      } else if (isSynthesized) {
        entry.matchedFields = ['synthesized', ...reasons];
      } else if (isCore) {
        entry.matchedFields = ['★ core', ...reasons];
      } else {
        entry.matchedFields = reasons;
      }
    }
  }

  // Apply token budget if specified (inspired by MemCP)
  if (options.maxTokens && options.maxTokens > 0) {
    entries = applyTokenBudget(entries, options.maxTokens);
  }

  // Record access for returned results (fire-and-forget, non-blocking)
  const hitDocs = results.hits.map((h) => ({ id: h.id, doc: h.document as unknown as MemorixDocument }));
  recordAccessBatch(hitDocs).catch(() => {});

  return entries;
}

/**
 * Get full observation documents by their observation IDs.
 *
 * Progressive Disclosure Layer 3 — adopted from claude-mem.
 */
export async function getObservationsByIds(
  ids: number[],
  projectId?: string,
): Promise<MemorixDocument[]> {
  const database = await getDb();

  // Search for each ID individually and collect results
  const results: MemorixDocument[] = [];

  for (const id of ids) {
    const searchResult = await search(database, {
      term: '',
      where: {
        observationId: { eq: id },
        ...(projectId ? { projectId } : {}),
      },
      limit: 1,
    });

    if (searchResult.hits.length > 0) {
      results.push(searchResult.hits[0].document as unknown as MemorixDocument);
    }
  }

  return results;
}

/**
 * Get observations around an anchor for timeline context.
 *
 * Progressive Disclosure Layer 2 — adopted from claude-mem.
 */
export async function getTimeline(
  anchorId: number,
  projectId?: string,
  depthBefore = 3,
  depthAfter = 3,
): Promise<{ before: IndexEntry[]; anchor: IndexEntry | null; after: IndexEntry[] }> {
  // Use in-memory observations for reliable lookup
  // (Orama search with empty term is unreliable — same fix as compactDetail)
  const { withFreshObservations, getAllObservations } = await import('../memory/observations.js');
  const rawObs = await withFreshObservations(() => getAllObservations());

  // Filter by project if specified — prevents cross-project context leaking
  const allObs = projectId
    ? rawObs.filter((o) => o.projectId === projectId)
    : rawObs;

  // Sort by creation time
  const sorted = allObs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const anchorIndex = sorted.findIndex((o) => o.id === anchorId);
  if (anchorIndex === -1) {
    return { before: [], anchor: null, after: [] };
  }

  const toIndexEntry = (obs: {
    id: number; type: string; title: string; tokens: number; createdAt: string;
    source?: string; sourceDetail?: string; valueCategory?: string;
  }): IndexEntry => {
    const obsType = obs.type as ObservationType;
    return {
      id: obs.id,
      time: formatTime(obs.createdAt),
      type: obsType,
      icon: OBSERVATION_ICONS[obsType] ?? '❓',
      title: obs.title,
      tokens: obs.tokens,
      source: (obs.source as IndexEntry['source']) || undefined,
      sourceDetail: (obs.sourceDetail as IndexEntry['sourceDetail']) || undefined,
      valueCategory: (obs.valueCategory as IndexEntry['valueCategory']) || undefined,
    };
  };

  const before = sorted
    .slice(Math.max(0, anchorIndex - depthBefore), anchorIndex)
    .map(toIndexEntry);

  const after = sorted
    .slice(anchorIndex + 1, anchorIndex + 1 + depthAfter)
    .map(toIndexEntry);

  return {
    before,
    anchor: toIndexEntry(sorted[anchorIndex]),
    after,
  };
}

/**
 * Record access for observations returned in search results.
 * Increments accessCount and updates lastAccessedAt.
 * Inspired by mcp-memory-service's record_access() pattern.
 */
async function recordAccessBatch(hitDocs: { id: string; doc: MemorixDocument }[]): Promise<void> {
  const database = await getDb();
  const now = new Date().toISOString();

  for (const { id, doc } of hitDocs) {
    try {
      // Use update() directly — no need to re-search since we already have the doc
      await update(database, id, {
        ...doc,
        accessCount: (doc.accessCount ?? 0) + 1,
        lastAccessedAt: now,
      });
    } catch {
      // Best-effort — don't break search if access tracking fails
    }
  }
}

/**
 * Trim search results to fit within a token budget.
 * Inspired by MemCP's _apply_token_budget() pattern.
 */
function applyTokenBudget(entries: IndexEntry[], maxTokens: number): IndexEntry[] {
  const budgeted: IndexEntry[] = [];
  let tokensUsed = 0;

  for (const entry of entries) {
    if (tokensUsed + entry.tokens > maxTokens && budgeted.length > 0) {
      break;
    }
    budgeted.push(entry);
    tokensUsed += entry.tokens;
  }

  return budgeted;
}

/**
 * Get total observation count, optionally filtered by project.
 */
export async function getObservationCount(projectId?: string): Promise<number> {
  const database = await getDb();
  if (!projectId) {
    return await count(database);
  }
  const results = await search(database, {
    term: '',
    where: { projectId },
    limit: 0,
  });
  return results.count;
}

/**
 * Format ISO date string to compact time display.
 */
function formatTime(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return isoDate;
  }
}
