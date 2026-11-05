import { createRetrievalFacade } from '../core/retrieval-facade.js';
import { searchObservationsDetailed } from '../store/orama-store.js';

export const retrievalFacade = createRetrievalFacade(async (plan) => {
  const result = await searchObservationsDetailed(plan);
  return { entries: result.entries, receipt: result.diagnostics, views: result.derivedViews };
});
