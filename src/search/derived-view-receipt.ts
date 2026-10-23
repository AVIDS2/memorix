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
