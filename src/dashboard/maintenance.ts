import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { initLLM, isLLMEnabled } from '../llm/provider.js';
import { analyzeCleanupObservations, applyCleanupMutations } from '../memory/cleanup.js';
import { findConsolidationCandidates, executeConsolidation } from '../memory/consolidation.js';
import { applyDeduplicationPlan, planMemoryDeduplication } from '../memory/deduplication.js';
import { archiveExpired, projectObservationRetention } from '../memory/retention.js';
import { canManageObservation, filterReadableObservations } from '../memory/visibility.js';
import type { ObservationStore } from '../store/obs-store.js';
import type { Observation, ObservationReader } from '../types.js';

const previewSecret = randomBytes(32);

export class DashboardMaintenanceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface DashboardMaintenanceContext {
  dataDir: string;
  projectId: string;
  projectRoot: string | null;
  store: ObservationStore;
}

interface CleanupTokenPayload {
  includeNoise: boolean;
  removeIds: number[];
  archiveIds: number[];
}

interface DeduplicateTokenPayload {
  resolveIds: number[];
}

interface ConsolidateTokenPayload {
  clusterIds: number[][];
}

interface RetentionTokenPayload {
  archiveIds: number[];
}

function reader(projectId: string): ObservationReader {
  return { projectId };
}

function summarize(observation: Observation) {
  return {
    id: observation.id,
    title: observation.title,
    type: observation.type,
    entityName: observation.entityName,
  };
}

function normalizeIds(ids: readonly number[]): number[] {
  return [...new Set(ids)].sort((left, right) => left - right);
}

function normalizeClusters(clusters: readonly (readonly number[])[]): number[][] {
  return clusters
    .map((ids) => normalizeIds(ids))
    .sort((left, right) => left.join(',').localeCompare(right.join(',')));
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new DashboardMaintenanceError('The maintenance preview payload is missing.', 400);
  }
  return payload as Record<string, unknown>;
}

function payloadIds(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || value.some((id) => !Number.isSafeInteger(id) || Number(id) <= 0)) {
    throw new DashboardMaintenanceError(`Invalid ${field} in maintenance preview.`, 400);
  }
  return normalizeIds(value as number[]);
}

function sign(action: string, projectId: string, payload: object): string {
  return createHmac('sha256', previewSecret)
    .update(JSON.stringify({ action, projectId, payload }))
    .digest('hex');
}

function verify(action: string, projectId: string, payload: object, token: unknown): void {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    throw new DashboardMaintenanceError('Preview this maintenance action before executing it.', 400);
  }
  const expected = Buffer.from(sign(action, projectId, payload), 'hex');
  const received = Buffer.from(token, 'hex');
  if (!timingSafeEqual(expected, received)) {
    throw new DashboardMaintenanceError('The maintenance preview is invalid or belongs to another project.', 409);
  }
}

function assertCurrent(expected: readonly number[], actual: readonly number[]): void {
  if (JSON.stringify(normalizeIds(expected)) !== JSON.stringify(normalizeIds(actual))) {
    throw new DashboardMaintenanceError('Memory changed after the preview. Refresh the preview before executing.', 409);
  }
}

async function manageableActiveObservations(context: DashboardMaintenanceContext): Promise<Observation[]> {
  const scope = reader(context.projectId);
  return filterReadableObservations(
    await context.store.loadByProject(context.projectId, { status: 'active' }),
    scope,
  ).filter((observation) => canManageObservation(observation, scope));
}

function cleanupPayload(includeNoise: boolean, analysis: ReturnType<typeof analyzeCleanupObservations>): CleanupTokenPayload {
  return {
    includeNoise,
    removeIds: normalizeIds(analysis.toRemove.map((observation) => observation.id)),
    archiveIds: normalizeIds(analysis.toArchive.map((observation) => observation.id)),
  };
}

export async function previewCleanup(context: DashboardMaintenanceContext, includeNoise: boolean) {
  const analysis = analyzeCleanupObservations(await manageableActiveObservations(context), { includeNoise });
  const payload = cleanupPayload(includeNoise, analysis);
  return {
    action: 'cleanup',
    projectId: context.projectId,
    includeNoise,
    summary: {
      totalActive: analysis.totalActive,
      highQuality: analysis.highQuality,
      lowQuality: analysis.lowQuality.length,
      duplicates: analysis.duplicates.length,
      noise: analysis.noise.length,
      delete: analysis.toRemove.length,
      archive: analysis.toArchive.length,
    },
    lowQuality: analysis.lowQuality.map(summarize),
    duplicateGroups: analysis.duplicateGroups.map((group) => ({
      canonical: summarize(group.canonical),
      duplicates: group.duplicates.map(summarize),
    })),
    noise: analysis.noise.map((hit) => ({ ...summarize(hit.observation), reason: hit.reason })),
    payload,
    token: sign('cleanup', context.projectId, payload),
  };
}

export async function executeCleanup(
  context: DashboardMaintenanceContext,
  payload: unknown,
  token: unknown,
) {
  const record = payloadRecord(payload);
  const normalized: CleanupTokenPayload = {
    includeNoise: record.includeNoise === true,
    removeIds: payloadIds(record.removeIds, 'removeIds'),
    archiveIds: payloadIds(record.archiveIds, 'archiveIds'),
  };
  verify('cleanup', context.projectId, normalized, token);
  const observations = await manageableActiveObservations(context);
  const analysis = analyzeCleanupObservations(observations, { includeNoise: normalized.includeNoise });
  const current = cleanupPayload(normalized.includeNoise, analysis);
  assertCurrent(normalized.removeIds, current.removeIds);
  assertCurrent(normalized.archiveIds, current.archiveIds);
  const result = await applyCleanupMutations(context.store, analysis.toArchive, analysis.toRemove);
  return { action: 'cleanup', projectId: context.projectId, ...result };
}

export async function previewDeduplicate(context: DashboardMaintenanceContext) {
  // Dashboard callers do not share the CLI/server bootstrap path. Resolve the
  // memory lane here so standalone and HTTP previews use the selected project.
  initLLM({ scope: 'memory', projectRoot: context.projectRoot });
  if (!isLLMEnabled()) {
    return {
      action: 'deduplicate',
      projectId: context.projectId,
      available: false,
      reason: 'Intelligent deduplication requires a configured memory LLM.',
    };
  }
  const plan = await planMemoryDeduplication(await manageableActiveObservations(context));
  const payload: DeduplicateTokenPayload = { resolveIds: normalizeIds(plan.resolveIds) };
  return {
    action: 'deduplicate',
    projectId: context.projectId,
    available: true,
    summary: {
      scanned: plan.scanned,
      entities: plan.entities,
      comparisons: plan.comparisons,
      failedComparisons: plan.failedComparisons,
      resolve: payload.resolveIds.length,
    },
    actions: plan.actions,
    payload,
    token: sign('deduplicate', context.projectId, payload),
  };
}

export async function executeDeduplicate(
  context: DashboardMaintenanceContext,
  payload: unknown,
  token: unknown,
) {
  const record = payloadRecord(payload);
  const normalized: DeduplicateTokenPayload = { resolveIds: payloadIds(record.resolveIds, 'resolveIds') };
  verify('deduplicate', context.projectId, normalized, token);
  const result = await applyDeduplicationPlan(
    context.store,
    context.projectId,
    normalized.resolveIds,
    reader(context.projectId),
  );
  if (result.skipped.length > 0) {
    throw new DashboardMaintenanceError('Memory changed after the preview. Refresh before applying deduplication.', 409);
  }
  return { action: 'deduplicate', projectId: context.projectId, ...result };
}

export async function previewConsolidate(context: DashboardMaintenanceContext) {
  const clusters = await findConsolidationCandidates(
    context.projectRoot ?? context.dataDir,
    context.projectId,
  );
  const payload: ConsolidateTokenPayload = { clusterIds: normalizeClusters(clusters.map((cluster) => cluster.ids)) };
  return {
    action: 'consolidate',
    projectId: context.projectId,
    summary: {
      clusters: clusters.length,
      observations: normalizeIds(clusters.flatMap((cluster) => cluster.ids)).length,
    },
    clusters,
    payload,
    token: sign('consolidate', context.projectId, payload),
  };
}

export async function executeConsolidate(
  context: DashboardMaintenanceContext,
  payload: unknown,
  token: unknown,
) {
  const record = payloadRecord(payload);
  if (!Array.isArray(record.clusterIds)) {
    throw new DashboardMaintenanceError('Invalid clusterIds in maintenance preview.', 400);
  }
  const clusterIds = record.clusterIds.map((ids, index) => payloadIds(ids, `clusterIds[${index}]`));
  const normalized: ConsolidateTokenPayload = { clusterIds: normalizeClusters(clusterIds) };
  verify('consolidate', context.projectId, normalized, token);
  const current = await findConsolidationCandidates(context.projectRoot ?? context.dataDir, context.projectId);
  if (JSON.stringify(normalized.clusterIds) !== JSON.stringify(normalizeClusters(current.map((cluster) => cluster.ids)))) {
    throw new DashboardMaintenanceError('Memory changed after the preview. Refresh before consolidating.', 409);
  }
  const result = await executeConsolidation(context.projectRoot ?? context.dataDir, context.projectId);
  return { action: 'consolidate', projectId: context.projectId, ...result };
}

async function retentionCandidates(context: DashboardMaintenanceContext) {
  return (await manageableActiveObservations(context))
    .map((observation) => ({
      observation,
      retention: projectObservationRetention(observation),
    }))
    .filter((row) => row.retention.zone === 'archive-candidate');
}

export async function previewRetentionArchive(context: DashboardMaintenanceContext) {
  const candidates = await retentionCandidates(context);
  const payload: RetentionTokenPayload = {
    archiveIds: normalizeIds(candidates.map((candidate) => candidate.observation.id)),
  };
  return {
    action: 'retention-archive',
    projectId: context.projectId,
    summary: { archive: payload.archiveIds.length },
    candidates: candidates.map(({ observation, retention }) => ({
      ...summarize(observation),
      score: retention.displayScore,
      zone: retention.zone,
      ageHours: retention.ageHours,
    })),
    payload,
    token: sign('retention-archive', context.projectId, payload),
  };
}

export async function executeRetentionArchive(
  context: DashboardMaintenanceContext,
  payload: unknown,
  token: unknown,
) {
  const record = payloadRecord(payload);
  const normalized: RetentionTokenPayload = { archiveIds: payloadIds(record.archiveIds, 'archiveIds') };
  verify('retention-archive', context.projectId, normalized, token);
  const current = await retentionCandidates(context);
  assertCurrent(normalized.archiveIds, current.map((candidate) => candidate.observation.id));
  const result = await archiveExpired(
    context.dataDir,
    undefined,
    undefined,
    context.projectId,
    reader(context.projectId),
  );
  return { action: 'retention-archive', projectId: context.projectId, ...result };
}
