/**
 * Orama Store
 *
 * Full-text + vector + hybrid search engine backed by Orama.
 * Source: @orama/orama (10.1K stars, <2KB, pure JS, zero deps)
 *
 * Schema designed to store Observations with all searchable fields.
 * Vector search (embeddings) will be added in P1 phase.
 */

import { create, insert, search, remove, count, type AnyOrama } from '@orama/orama';
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

  const filters: Record<string, unknown> = {};
  if (options.projectId) {
    filters['projectId'] = options.projectId;
  }
  if (options.type) {
    filters['type'] = options.type;
  }

  // Determine search mode: hybrid (with vector) or fulltext (default)
  let searchParams: Record<string, unknown> = {
    term: options.query,
    limit: options.limit ?? 20,
    ...(Object.keys(filters).length > 0 ? { where: filters } : {}),
  };

  // If embedding provider is available and we have a query, use hybrid search
  if (embeddingEnabled && options.query && options.query.trim().length > 0) {
    try {
      const provider = await getEmbeddingProvider();
      if (provider) {
        const queryVector = await provider.embed(options.query);
        searchParams = {
          ...searchParams,
          mode: 'hybrid',
          vector: {
            value: queryVector,
            property: 'embedding',
          },
          similarity: 0.7,
        };
      }
    } catch {
      // Fallback to fulltext if embedding fails
    }
  }

  const results = await search(database, searchParams);

  let entries = results.hits.map((hit) => {
    const doc = hit.document as unknown as MemorixDocument;
    const obsType = doc.type as ObservationType;
    return {
      id: doc.observationId,
      time: formatTime(doc.createdAt),
      type: obsType,
      icon: OBSERVATION_ICONS[obsType] ?? '❓',
      title: doc.title,
      tokens: doc.tokens,
    };
  });

  // Apply token budget if specified (inspired by MemCP)
  if (options.maxTokens && options.maxTokens > 0) {
    entries = applyTokenBudget(entries, options.maxTokens);
  }

  // Record access for returned results (inspired by mcp-memory-service)
  const hitIds = results.hits.map((h) => (h.document as unknown as MemorixDocument).id);
  recordAccessBatch(hitIds).catch(() => {});

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
  const database = await getDb();

  // Get all observations sorted by time (no projectId filter — shared across agents)
  const searchParams: { term: string; where?: Record<string, unknown>; limit: number } = {
    term: '',
    limit: 1000,
  };
  if (projectId) {
    searchParams.where = { projectId };
  }
  const allResults = await search(database, searchParams);

  const docs = allResults.hits
    .map((h) => h.document as unknown as MemorixDocument)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const anchorIndex = docs.findIndex((d) => d.observationId === anchorId);
  if (anchorIndex === -1) {
    return { before: [], anchor: null, after: [] };
  }

  const toIndexEntry = (doc: MemorixDocument): IndexEntry => {
    const obsType = doc.type as ObservationType;
    return {
      id: doc.observationId,
      time: formatTime(doc.createdAt),
      type: obsType,
      icon: OBSERVATION_ICONS[obsType] ?? '❓',
      title: doc.title,
      tokens: doc.tokens,
    };
  };

  const before = docs
    .slice(Math.max(0, anchorIndex - depthBefore), anchorIndex)
    .map(toIndexEntry);

  const after = docs
    .slice(anchorIndex + 1, anchorIndex + 1 + depthAfter)
    .map(toIndexEntry);

  return {
    before,
    anchor: toIndexEntry(docs[anchorIndex]),
    after,
  };
}

/**
 * Record access for observations returned in search results.
 * Increments accessCount and updates lastAccessedAt.
 * Inspired by mcp-memory-service's record_access() pattern.
 */
async function recordAccessBatch(oramaIds: string[]): Promise<void> {
  const database = await getDb();
  const now = new Date().toISOString();

  for (const id of oramaIds) {
    try {
      // Fetch current doc
      const result = await search(database, {
        term: '',
        where: { id },
        limit: 1,
      });
      if (result.hits.length === 0) continue;
      const doc = result.hits[0].document as unknown as MemorixDocument;

      // Remove and re-insert with updated access metadata
      await remove(database, id);
      await insert(database, {
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
