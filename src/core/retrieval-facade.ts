import type { IndexEntry, SearchOptions } from '../types.js';
import { createRetrievalPlan, type RetrievalPlan, type RetrievalReceipt } from './retrieval-contracts.js';

export interface RetrievalExecution<Views> {
  entries: IndexEntry[];
  receipt: RetrievalReceipt;
  views: Views;
}

export function createRetrievalFacade<Views>(
  run: (plan: RetrievalPlan) => Promise<RetrievalExecution<Views>>,
): { search(options: SearchOptions): Promise<RetrievalExecution<Views>> } {
  return {
    search(options) {
      return run(createRetrievalPlan(options));
    },
  };
}
