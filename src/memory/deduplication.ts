import type { CompactDecision } from '../llm/memory-manager.js';
import { deduplicateMemory } from '../llm/memory-manager.js';
import type { ObservationStore } from '../store/obs-store.js';
import type { Observation, ObservationReader } from '../types.js';
import { canManageObservation } from './visibility.js';

export interface DeduplicationAction {
  resolveId: number;
  keepId: number;
  entityName: string;
  resolveTitle: string;
  keepTitle: string;
  reason: string;
  decision: 'UPDATE' | 'DELETE' | 'NONE';
  usedLLM: boolean;
}

export interface DeduplicationPlan {
  scanned: number;
  entities: number;
  comparisons: number;
  failedComparisons: number;
  actions: DeduplicationAction[];
  resolveIds: number[];
}

type DeduplicationDecision = (
  newer: { title: string; narrative: string; facts: string[] },
  existing: Array<{ id: number; title: string; narrative: string; facts: string }>,
) => Promise<CompactDecision | null>;

function chronological(left: Observation, right: Observation): number {
  const byTime = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  return byTime || left.id - right.id;
}

function actionFromDecision(
  older: Observation,
  newer: Observation,
  decision: CompactDecision,
): DeduplicationAction | null {
  let resolveId: number;
  let keepId: number;

  if (decision.action === 'NONE') {
    resolveId = newer.id;
    keepId = older.id;
  } else if (decision.action === 'UPDATE') {
    resolveId = decision.targetId ?? older.id;
    keepId = resolveId === newer.id ? older.id : newer.id;
  } else if (decision.action === 'DELETE') {
    resolveId = decision.targetId ?? older.id;
    keepId = resolveId === newer.id ? older.id : newer.id;
  } else {
    return null;
  }

  const records = new Map([[older.id, older], [newer.id, newer]]);
  const resolved = records.get(resolveId);
  const kept = records.get(keepId);
  if (!resolved || !kept || resolved.id === kept.id) return null;

  return {
    resolveId,
    keepId,
    entityName: newer.entityName,
    resolveTitle: resolved.title,
    keepTitle: kept.title,
    reason: decision.reason,
    decision: decision.action,
    usedLLM: decision.usedLLM,
  };
}

/**
 * Build one deterministic, reviewable deduplication plan. Callers own project,
 * visibility, and optional search filtering before passing observations in.
 */
export async function planMemoryDeduplication(
  observations: readonly Observation[],
  options: { limit?: number; decide?: DeduplicationDecision } = {},
): Promise<DeduplicationPlan> {
  const limit = Math.min(100, Math.max(2, Math.floor(options.limit ?? 20)));
  const candidates = observations
    .filter((observation) => (observation.status ?? 'active') === 'active')
    .sort(chronological)
    .slice(-limit);
  const byEntity = new Map<string, Observation[]>();
  for (const observation of candidates) {
    const group = byEntity.get(observation.entityName) ?? [];
    group.push(observation);
    byEntity.set(observation.entityName, group);
  }

  const decide = options.decide ?? deduplicateMemory;
  const actions = new Map<number, DeduplicationAction>();
  let comparisons = 0;
  let failedComparisons = 0;

  for (const group of byEntity.values()) {
    if (group.length < 2) continue;
    group.sort(chronological);
    for (let index = 0; index < group.length; index += 1) {
      for (let compareIndex = index + 1; compareIndex < group.length; compareIndex += 1) {
        const older = group[index];
        const newer = group[compareIndex];
        comparisons += 1;
        let decision: CompactDecision | null;
        try {
          decision = await decide(
            { title: newer.title, narrative: newer.narrative, facts: newer.facts },
            [{ id: older.id, title: older.title, narrative: older.narrative, facts: older.facts.join('\n') }],
          );
        } catch {
          failedComparisons += 1;
          continue;
        }
        if (!decision) continue;
        const action = actionFromDecision(older, newer, decision);
        if (action && !actions.has(action.resolveId)) actions.set(action.resolveId, action);
      }
    }
  }

  const planned = [...actions.values()];
  for (const [entityName, group] of byEntity) {
    const resolvedIds = new Set(
      planned.filter((action) => action.entityName === entityName).map((action) => action.resolveId),
    );
    if (group.length > 0 && group.every((observation) => resolvedIds.has(observation.id))) {
      const survivor = group[group.length - 1];
      const unsafeIndex = planned.findIndex((action) => action.resolveId === survivor.id);
      if (unsafeIndex >= 0) planned.splice(unsafeIndex, 1);
    }
  }
  return {
    scanned: candidates.length,
    entities: byEntity.size,
    comparisons,
    failedComparisons,
    actions: planned,
    resolveIds: planned.map((action) => action.resolveId),
  };
}

export async function applyDeduplicationPlan(
  store: ObservationStore,
  projectId: string,
  resolveIds: readonly number[],
  reader: ObservationReader = { projectId },
): Promise<{ resolved: number[]; skipped: number[] }> {
  const uniqueIds = [...new Set(resolveIds)];
  const manageable: number[] = [];
  const skipped: number[] = [];

  for (const id of uniqueIds) {
    const observation = await store.getById(id);
    if (
      observation
      && observation.projectId === projectId
      && (observation.status ?? 'active') === 'active'
      && canManageObservation(observation, reader)
    ) {
      manageable.push(id);
    } else {
      skipped.push(id);
    }
  }

  const resolved = skipped.length > 0 || manageable.length === 0
    ? []
    : await store.atomic(async (tx) => {
      const updates = await Promise.all(manageable.map((id) => tx.setStatus(id, 'resolved', 'active')));
      return manageable.filter((_, index) => updates[index]);
    });

  return { resolved, skipped };
}
