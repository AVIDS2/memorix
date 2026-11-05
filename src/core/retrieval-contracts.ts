import type { ObservationReader, RetrievalQuality, SearchOptions } from '../types.js';

/**
 * Host-independent retrieval intent. Hosts may add presentation details, but
 * the search engine receives one normalized plan before choosing derived views.
 */
export interface RetrievalPlan {
  query: string;
  quality: RetrievalQuality;
  limit: number;
  projectId?: string;
  status: SearchOptions['status'];
  source?: SearchOptions['source'];
  type?: SearchOptions['type'];
  since?: string;
  until?: string;
  maxTokens: number;
  trackAccess: boolean;
  reader?: ObservationReader;
  surfacedIds: number[];
  signal?: AbortSignal;
}

export interface RetrievalReceipt {
  version: '1';
  mode: string;
  candidateCount: number;
  selectedCount: number;
  omittedCount: number;
  omittedByTokenBudget: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
  elapsedMs: number;
}

export function createRetrievalPlan(options: SearchOptions): RetrievalPlan {
  const requestedLimit = Number.isFinite(options.limit) ? Math.floor(options.limit ?? 20) : 20;
  const requestedTokens = Number.isFinite(options.maxTokens) ? Math.floor(options.maxTokens ?? 0) : 0;
  return {
    query: options.query.trim(),
    quality: options.quality ?? 'balanced',
    limit: Math.max(1, Math.min(10_000, requestedLimit)),
    ...(options.projectId ? { projectId: options.projectId } : {}),
    status: options.status ?? 'active',
    ...(options.source ? { source: options.source } : {}),
    ...(options.type ? { type: options.type } : {}),
    ...(options.since ? { since: options.since } : {}),
    ...(options.until ? { until: options.until } : {}),
    maxTokens: Math.max(0, requestedTokens),
    trackAccess: options.trackAccess !== false,
    reader: options.reader,
    surfacedIds: [...(options.surfacedIds ?? [])],
    signal: options.signal,
  };
}
