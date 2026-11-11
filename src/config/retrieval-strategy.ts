export type RetrievalStrategy = 'vector' | 'hybrid';

const CJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g;

export function isCjkHeavyQuery(query: string): boolean {
  if (!query) return false;
  const matches = query.match(CJK);
  return (matches?.length ?? 0) / query.length > 0.3;
}

export function normalizeRetrievalStrategy(value: unknown): RetrievalStrategy | undefined {
  if (value === 'vector' || value === 'hybrid') return value;
  return undefined;
}

export function firstRetrievalStrategy(fallback: RetrievalStrategy, ...values: unknown[]): RetrievalStrategy {
  for (const value of values) {
    const normalized = normalizeRetrievalStrategy(value);
    if (normalized) return normalized;
  }
  return fallback;
}
