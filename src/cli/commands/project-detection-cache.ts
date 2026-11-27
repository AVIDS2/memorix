/**
 * Short-lived memo for project detection on the HTTP request path.
 *
 * Stateless (2026-07-28) MCP requests carry no session, so serve-http resolves
 * the project root on every request, up to three times. When that root is not
 * inside a Git repository, detection falls through to a synchronous
 * `git rev-parse` subprocess, which blocks the event loop. On hosts where
 * process creation is slow (endpoint security scanners on Windows routinely
 * add one to several seconds), the stateless probe of clients such as Claude
 * Code then exceeds its budget and the client falls back to legacy sessions.
 *
 * Results, including "not a project", are cached per path for a bounded time
 * so the subprocess runs at most once per path per TTL.
 */

import type { ProjectInfo } from '../../types.js';

export const DEFAULT_PROJECT_DETECTION_CACHE_TTL_MS = 5 * 60 * 1000;
export const MAX_PROJECT_DETECTION_CACHE_ENTRIES = 256;

export interface ProjectDetectionCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export type CachedProjectDetector = ((root: string) => ProjectInfo | null) & {
  /** Drop every cached result. */
  clear(): void;
  /** Number of cached paths (diagnostics/tests). */
  size(): number;
};

export function createCachedProjectDetector(
  detect: (root: string) => ProjectInfo | null,
  options: ProjectDetectionCacheOptions = {},
): CachedProjectDetector {
  const ttlMs = options.ttlMs ?? DEFAULT_PROJECT_DETECTION_CACHE_TTL_MS;
  const maxEntries = options.maxEntries ?? MAX_PROJECT_DETECTION_CACHE_ENTRIES;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { project: ProjectInfo | null; expiresAt: number }>();

  const cached = ((root: string) => {
    const at = now();
    const hit = cache.get(root);
    if (hit && hit.expiresAt > at) return hit.project;
    const project = detect(root);
    cache.delete(root);
    cache.set(root, { project, expiresAt: at + ttlMs });
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return project;
  }) as CachedProjectDetector;

  cached.clear = () => cache.clear();
  cached.size = () => cache.size;
  return cached;
}
