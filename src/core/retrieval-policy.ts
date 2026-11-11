import type { IndexEntry, SearchOptions } from '../types.js';
import type { RetrievalExecution } from './retrieval-facade.js';

export interface RetrievalFeedbackState {
  weight: number;
  status: string;
}

/** Pure feedback weight used by retrieval and retention. */
export function feedbackWeightMultiplier(weight: number): number {
  return Math.max(0.35, Math.min(1.4, 0.35 + Math.max(0, Math.min(2, weight)) * 0.525));
}

/** Apply project feedback to one result set and keep its receipt truthful. */
export function applyRetrievalFeedback<Views>(
  execution: RetrievalExecution<Views>,
  states: ReadonlyMap<string, RetrievalFeedbackState>,
  status: SearchOptions['status'],
): RetrievalExecution<Views> {
  const scored = execution.entries.map((entry): IndexEntry => {
    const state = states.get(String(entry.id));
    if (!state) return entry;
    return {
      ...entry,
      score: (entry.score ?? 0) * feedbackWeightMultiplier(state.weight),
      feedbackWeight: state.weight,
      feedbackStatus: state.status as IndexEntry['feedbackStatus'],
    };
  });
  const entries = scored
    .filter((entry) => entry.feedbackStatus !== 'archived' || status === 'all')
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
  const omittedByFeedback = scored.length - entries.length;
  return {
    ...execution,
    entries,
    receipt: {
      ...execution.receipt,
      selectedCount: entries.length,
      omittedCount: Math.max(0, execution.receipt.candidateCount - entries.length),
      omittedByFeedback,
    },
  };
}
