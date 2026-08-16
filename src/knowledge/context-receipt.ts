import type { CodeGraphProviderQuality } from '../codegraph/types.js';
import type { TaskWorkset } from './workset.js';

/**
 * A small machine-readable counterpart to the agent-facing Workset prompt.
 * Detailed CLI JSON remains available for diagnostics; this shape is for
 * clients that need a bounded handoff without loading raw stores.
 */
export interface BoundedContextReceipt {
  schemaVersion: '1';
  task: string;
  brief: string;
  receipt: TaskWorkset['receipt'];
  code: {
    selected: CodeGraphProviderQuality['selected'];
    quality: CodeGraphProviderQuality['selectedQuality'];
    externalState: CodeGraphProviderQuality['external']['state'];
    snapshotId?: string;
  };
  loadout?: TaskWorkset['agentLoadout'];
}

export function buildBoundedContextReceipt(input: {
  workset: TaskWorkset;
  providerQuality?: CodeGraphProviderQuality;
}): BoundedContextReceipt {
  const provider = input.providerQuality ?? input.workset.provenance.codeProvider;
  return {
    schemaVersion: '1',
    task: input.workset.task,
    brief: input.workset.prompt,
    receipt: input.workset.receipt,
    code: {
      selected: provider?.selected ?? 'lite',
      quality: provider?.selectedQuality ?? 'heuristic',
      externalState: provider?.external.state ?? 'not-detected',
      ...(input.workset.provenance.snapshotId ? { snapshotId: input.workset.provenance.snapshotId } : {}),
    },
    ...(input.workset.agentLoadout ? { loadout: input.workset.agentLoadout } : {}),
  };
}
