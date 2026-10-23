import type { CodeGraphProviderQuality } from '../codegraph/types.js';
import type { RetrievalDerivedViewReceipt } from '../search/derived-view-receipt.js';
import type { TaskWorkset } from './workset.js';
import type { TaskContinuityLedger } from './task-continuity.js';

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
  continuity?: {
    taskId: string;
    status: TaskContinuityLedger['status'];
    outcome: TaskContinuityLedger['outcome'];
  };
}

/** Build the graph view status without exposing source contents or paths. */
export function buildCodeGraphDerivedView(input: {
  providerQuality?: CodeGraphProviderQuality;
  snapshot?: { id?: string; sourceEpoch?: number; incomplete?: boolean };
}): RetrievalDerivedViewReceipt {
  const provider = input.providerQuality;
  const snapshot = input.snapshot;
  const externalFailure = provider?.external.state !== undefined
    && !['ready', 'disabled', 'not-detected'].includes(provider.external.state);
  if (snapshot?.id) {
    return {
      ...(snapshot.sourceEpoch !== undefined ? { generation: snapshot.sourceEpoch } : {}),
      freshness: snapshot.incomplete ? 'stale' : 'current',
      rebuildStatus: snapshot.incomplete ? 'failed' : 'idle',
      ...(snapshot.incomplete
        ? { failureReason: 'latest CodeGraph snapshot is incomplete' }
        : externalFailure && provider?.external.reason
          ? { failureReason: provider.external.reason.slice(0, 240) }
          : {}),
    };
  }

  return {
    freshness: 'unknown',
    rebuildStatus: externalFailure ? 'failed' : 'unavailable',
    ...(provider?.external.reason
      ? { failureReason: provider.external.reason.slice(0, 240) }
      : { failureReason: 'CodeGraph snapshot is not initialized' }),
  };
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
    ...(input.workset.continuity
      ? {
        continuity: {
          taskId: input.workset.continuity.taskId,
          status: input.workset.continuity.status,
          outcome: input.workset.continuity.outcome,
        },
      }
      : {}),
  };
}
