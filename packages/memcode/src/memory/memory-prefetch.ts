/**
 * Memory Prefetcher
 *
 * Solves the "Sending..." latency problem by searching memories
 * while the user is still typing, so results are ready at send time.
 *
 * Flow:
 *   User types → debounce 300ms → compactSearch() → cache result
 *   User sends → read cache (hit) → instant injection
 *             → read cache (miss) → 300ms timeout race fallback
 *
 * Target: P50 < 50ms (cache hit), P95 < 400ms (fallback path)
 */

import { importFromMemorix } from '../core/memorix-resolve.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CachedResult {
  entries: any[];
  formatted: string;
  ts: number;
}

interface PrefetchConfig {
  enabled: boolean;
  debounceMs: number;
  cacheTtlMs: number;
  fallbackTimeoutMs: number;
  maxResults: number;
  maxTokens: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: PrefetchConfig = {
  enabled: true,
  debounceMs: 300,
  cacheTtlMs: 30_000,      // 30s cache TTL
  fallbackTimeoutMs: 300,  // 300ms hard timeout for fallback
  maxResults: 5,
  maxTokens: 2000,
};

// ---------------------------------------------------------------------------
// Lazy import for compactSearch
// ---------------------------------------------------------------------------

let _compactSearchFn: ((opts: any) => Promise<any>) | null = null;

async function getCompactSearch() {
  if (!_compactSearchFn) {
    const mod = await importFromMemorix('compact/engine.js');
    _compactSearchFn = mod.compactSearch;
  }
  return _compactSearchFn;
}

// ---------------------------------------------------------------------------
// Query extraction (same as memory-injection.ts)
// ---------------------------------------------------------------------------

function extractSearchQuery(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return '';
  if (trimmed.length > 500) return trimmed.slice(0, 500);
  return trimmed;
}

// ---------------------------------------------------------------------------
// MemoryPrefetcher class
// ---------------------------------------------------------------------------

export class MemoryPrefetcher {
  private cache: Map<string, CachedResult> = new Map();
  private inflight: Promise<CachedResult | null> | null = null;
  private inflightQuery: string = '';
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private projectId: string = '';
  private config: PrefetchConfig;
  private abortController: AbortController | null = null;

  constructor(projectId: string, config: Partial<PrefetchConfig> = {}) {
    this.projectId = projectId;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // --- Public API ---

  /**
   * Called on every input change. Debounces and triggers prefetch.
   * Non-blocking — fires and forgets.
   */
  onInput(text: string): void {
    if (!this.config.enabled) return;

    // Cancel previous debounce
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    const query = extractSearchQuery(text);
    if (!query || query.length < 3) return; // too short, skip

    this.debounceTimer = setTimeout(() => {
      this.prefetch(query).catch(() => {
        // Prefetch failure is silent — fallback will handle it
      });
    }, this.config.debounceMs);
  }

  /**
   * Called at send time. Returns cached result or races against timeout.
   * This is the function that replaces the synchronous compactSearch() call.
   */
  async getCachedOrFetch(query: string): Promise<CachedResult | null> {
    if (!this.config.enabled) return null;

    const normalizedQuery = extractSearchQuery(query);
    if (!normalizedQuery) return null;

    // 1. Exact cache hit
    const hit = this.cache.get(normalizedQuery);
    if (hit && Date.now() - hit.ts < this.config.cacheTtlMs) {
      return hit;
    }

    // 2. Prefix/similarity hit — check if a longer query already searched
    //    e.g., user typed "how to fix auth" and cache has "how to fix auth bug"
    for (const [cachedQuery, cached] of this.cache) {
      if (
        normalizedQuery.startsWith(cachedQuery) &&
        Date.now() - cached.ts < this.config.cacheTtlMs
      ) {
        return cached;
      }
    }

    // 3. Inflight request — wait up to fallbackTimeoutMs
    if (this.inflight && this.inflightQuery.startsWith(normalizedQuery.slice(0, 20))) {
      try {
        const result = await Promise.race([
          this.inflight,
          new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), this.config.fallbackTimeoutMs)
          ),
        ]);
        return result;
      } catch {
        return null;
      }
    }

    // 4. No cache, no inflight — do a quick fetch with timeout
    return this.fetchWithTimeout(normalizedQuery);
  }

  /**
   * Update project ID (e.g., on project switch).
   */
  setProjectId(projectId: string): void {
    if (this.projectId !== projectId) {
      this.projectId = projectId;
      this.cache.clear(); // Invalidate cache on project change
    }
  }

  /**
   * Clear all caches. Call on session end.
   */
  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.cache.clear();
    this.inflight = null;
  }

  // --- Internal ---

  private async prefetch(query: string): Promise<void> {
    // Cancel previous inflight
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    const fetchPromise = this.doSearch(query);
    this.inflight = fetchPromise;
    this.inflightQuery = query;

    try {
      const result = await fetchPromise;
      if (result) {
        this.cache.set(query, result);
      }
    } catch {
      // Silent — fallback handles it
    } finally {
      this.inflight = null;
      this.inflightQuery = '';
    }
  }

  private async fetchWithTimeout(query: string): Promise<CachedResult | null> {
    try {
      const result = await Promise.race([
        this.doSearch(query),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), this.config.fallbackTimeoutMs)
        ),
      ]);
      if (result) {
        this.cache.set(query, result);
      }
      return result;
    } catch {
      return null;
    }
  }

  private async doSearch(query: string): Promise<CachedResult | null> {
    const compactSearch = await getCompactSearch();
    if (!compactSearch) return null;
    const { entries, formatted } = await compactSearch({
      query,
      projectId: this.projectId,
      limit: this.config.maxResults,
      maxTokens: this.config.maxTokens,
    });
    if (!entries || entries.length === 0) return null;
    return { entries, formatted, ts: Date.now() };
  }
}

// ---------------------------------------------------------------------------
// Singleton — shared between TUI and injection hook
// ---------------------------------------------------------------------------

let _instance: MemoryPrefetcher | null = null;

export function getPrefetcher(projectId: string): MemoryPrefetcher {
  if (!_instance) {
    _instance = new MemoryPrefetcher(projectId);
  }
  _instance.setProjectId(projectId);
  return _instance;
}

export function disposePrefetcher(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}
