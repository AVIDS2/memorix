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
import type { MemorixDocument, SearchOptions, IndexEntry } from '../types.js';
import { OBSERVATION_ICONS, type ObservationType } from '../types.js';
import { getEmbeddingProvider, type EmbeddingProvider } from '../embedding/provider.js';

let db: AnyOrama | null = null;
let embeddingEnabled = false;

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
  };

  const schema = embeddingEnabled
    ? { ...baseSchema, embedding: 'vector[384]' as const }
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
}

/**
 * Check if embedding/vector search is active.
 */
export function isEmbeddingEnabled(): boolean {
  return embeddingEnabled;
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
  } catch {
    return texts.map(() => null);
  }
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

  // Determine search mode: hybrid (with vector) or fulltext (default)
  const hasQuery = options.query && options.query.trim().length > 0;
  // When post-filtering by multiple project aliases, request extra results to compensate
  const requestLimit = (projectIds && projectIds.length > 1)
    ? (options.limit ?? 20) * 3
    : (options.limit ?? 20);
  let searchParams: Record<string, unknown> = {
    term: options.query,
    limit: requestLimit,
    ...(Object.keys(filters).length > 0 ? { where: filters } : {}),
    // Search specific fields (not tokens, accessCount, etc.)
    properties: ['title', 'entityName', 'narrative', 'facts', 'concepts', 'filesModified'],
    // Field boosting: title and entity matches rank higher
    boost: {
      title: 3,
      entityName: 2,
      concepts: 1.5,
      narrative: 1,
      facts: 1,
      filesModified: 0.5,
    },
    // Fuzzy tolerance: allow 1-char typos for short queries, 2 for longer
    ...(hasQuery ? { tolerance: options.query!.length > 6 ? 2 : 1 } : {}),
  };

  // If embedding provider is available and we have a query, use hybrid search
  if (embeddingEnabled && hasQuery) {
    try {
      const provider = await getEmbeddingProvider();
      if (provider) {
        const queryVector = await provider.embed(options.query!);
        searchParams = {
          ...searchParams,
          mode: 'hybrid',
          vector: {
            value: queryVector,
            property: 'embedding',
          },
          similarity: 0.5,
          hybridWeights: {
            text: 0.6,
            vector: 0.4,
          },
        };
      }
    } catch {
      // Fallback to fulltext if embedding fails
    }
  }

  const results = await search(database, searchParams);

  // Build intermediate results with rawTime for temporal filtering
  let intermediate = results.hits
    // Post-filter by project aliases when multiple aliases exist (Orama doesn't support `in` for strings)
    .filter((hit) => {
      if (!projectIds || projectIds.length <= 1) return true;
      const doc = hit.document as unknown as MemorixDocument;
      return projectIds.includes(doc.projectId);
    })
    .map((hit) => {
      const doc = hit.document as unknown as MemorixDocument;
      const obsType = doc.type as ObservationType;
      return {
        id: doc.observationId,
        time: formatTime(doc.createdAt),
        rawTime: doc.createdAt,
        type: obsType,
        icon: OBSERVATION_ICONS[obsType] ?? '❓',
        title: doc.title,
        tokens: doc.tokens,
      };
    });

  // Temporal filtering: since/until date range
  if (options.since) {
    const sinceDate = new Date(options.since).getTime();
    intermediate = intermediate.filter(e => new Date(e.rawTime).getTime() >= sinceDate);
  }
  if (options.until) {
    const untilDate = new Date(options.until).getTime();
    intermediate = intermediate.filter(e => new Date(e.rawTime).getTime() <= untilDate);
  }

  // Apply original limit after post-filtering (we requested extra when multi-alias post-filter is active)
  if (projectIds && projectIds.length > 1) {
    intermediate = intermediate.slice(0, options.limit ?? 20);
  }

  // Build IndexEntry with optional match explanation
  let entries: IndexEntry[] = intermediate.map(({ rawTime: _, ...rest }) => rest);

  // Explainable recall: annotate entries with match reasons (O(1) lookup via Map)
  if (hasQuery && options.query) {
    const queryLower = options.query.toLowerCase();
    const queryTokens = queryLower.split(/\s+/).filter(t => t.length > 1);
    const entryMap = new Map(entries.map(e => [e.id, e]));
    for (const hit of results.hits) {
      const doc = hit.document as unknown as MemorixDocument;
      const entry = entryMap.get(doc.observationId);
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
      (entry as unknown as Record<string, unknown>)['matchedFields'] = reasons;
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
  _projectId?: string,
  depthBefore = 3,
  depthAfter = 3,
): Promise<{ before: IndexEntry[]; anchor: IndexEntry | null; after: IndexEntry[] }> {
  // Use in-memory observations for reliable lookup
  // (Orama search with empty term is unreliable — same fix as compactDetail)
  const { getAllObservations } = await import('../memory/observations.js');
  const allObs = getAllObservations();

  // Sort by creation time
  const sorted = allObs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const anchorIndex = sorted.findIndex((o) => o.id === anchorId);
  if (anchorIndex === -1) {
    return { before: [], anchor: null, after: [] };
  }

  const toIndexEntry = (obs: { id: number; type: string; title: string; tokens: number; createdAt: string }): IndexEntry => {
    const obsType = obs.type as ObservationType;
    return {
      id: obs.id,
      time: formatTime(obs.createdAt),
      type: obsType,
      icon: OBSERVATION_ICONS[obsType] ?? '❓',
      title: obs.title,
      tokens: obs.tokens,
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
