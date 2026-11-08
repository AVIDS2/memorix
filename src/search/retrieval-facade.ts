import { createRetrievalFacade } from '../core/retrieval-facade.js';
import { applyRetrievalFeedback } from '../core/retrieval-policy.js';
import { MemoryFeedbackStore } from '../memory/feedback.js';
import { getObservationStoreDataDir } from '../store/obs-store.js';
import { searchObservationsDetailed } from '../store/orama-store.js';

export const retrievalFacade = createRetrievalFacade(async (plan) => {
  const result = await searchObservationsDetailed(plan);
  const execution = {
    entries: result.entries,
    receipt: result.diagnostics,
    views: result.derivedViews,
  };
  let selected;
  if (!plan.projectId || execution.entries.length === 0) {
    selected = { ...execution, receipt: { ...execution.receipt, omittedByFeedback: 0 } };
  } else {
    try {
      const feedback = new MemoryFeedbackStore();
      await feedback.init(getObservationStoreDataDir());
      selected = applyRetrievalFeedback(execution, feedback.weights(plan.projectId, 'observation'), plan.status);
    } catch {
      selected = {
        ...execution,
        receipt: {
          ...execution.receipt,
          omittedByFeedback: 0,
          degradedReasons: [
            ...(execution.receipt.degradedReasons ?? []),
            'feedback state unavailable',
          ],
        },
      };
    }
  }
  result.recordAccess?.(selected.entries);
  return selected;
});
