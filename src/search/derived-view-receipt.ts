import { sanitizeCredentials } from '../memory/secret-filter.js';
import type { EmbeddingRuntimeHealth } from '../embedding/provider.js';

/** Privacy-safe health metadata for retrieval's derived evidence views. */
export type RetrievalDerivedViewName = 'fts' | 'orama' | 'embedding' | 'graph';

export type RetrievalDerivedViewFreshness = 'current' | 'stale' | 'unknown';

export type RetrievalDerivedViewRebuildStatus =
  | 'idle'
  | 'rebuilding'
  | 'unavailable'
  | 'failed'
  | 'disabled';

export interface RetrievalDerivedViewReceipt {
  /** Durable or process-local generation when one exists. */
  generation?: number;
  freshness: RetrievalDerivedViewFreshness;
  rebuildStatus: RetrievalDerivedViewRebuildStatus;
  /** Bounded operator-facing reason; never raw memory content. */
  failureReason?: string;
}

export type RetrievalDerivedViews = Partial<Record<RetrievalDerivedViewName, RetrievalDerivedViewReceipt>>;

/** Normalize an operator-facing failure without persisting credentials or host paths. */
export function sanitizeDerivedViewFailureReason(reason: string): string {
  const safe = sanitizeCredentials(reason)
    .replace(/(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:home|Users|tmp|var|private|mnt|workspace|workspaces)\/)[^\s"'<>|]*/gi, '[path]')
    .replace(/\s+/g, ' ')
    .trim();
  return safe.slice(0, 240) || 'derived view failed';
}

export function embeddingHealthReceipt(
  health: EmbeddingRuntimeHealth | undefined,
  embeddingEnabled: boolean,
): RetrievalDerivedViewReceipt {
  if (health?.status === 'disabled') {
    return { freshness: 'current', rebuildStatus: 'disabled' };
  }
  if (health?.status === 'ready' || embeddingEnabled) {
    return { freshness: 'current', rebuildStatus: 'idle' };
  }
  if (health?.status === 'degraded') {
    return {
      freshness: 'stale',
      rebuildStatus: 'failed',
      ...(health.failure
        ? {
          failureReason: `embedding ${health.failure.kind}; retry in ${health.failure.retryAfterMs}ms`,
        }
        : { failureReason: 'embedding provider degraded' }),
    };
  }
  return {
    freshness: 'unknown',
    rebuildStatus: 'unavailable',
    failureReason: 'embedding provider is not initialized',
  };
}
