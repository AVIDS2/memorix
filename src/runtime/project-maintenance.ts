import type {
  MaintenanceJobHandler,
  MaintenanceJobRunResult,
} from './maintenance-jobs.js';
import { runMaintenanceInChildProcess } from './isolated-maintenance.js';
import {
  enqueueClaimRequalification,
  enqueueKnowledgeFollowups,
  enqueueObservationQualification,
  type MaintenanceQueue,
} from './lifecycle.js';

const DEFAULT_VECTOR_BATCH_SIZE = 12;
const DEFAULT_RETENTION_BATCH_SIZE = 100;
const DEFAULT_CONSOLIDATION_BATCH_SIZE = 200;
const DEFAULT_CODEGRAPH_MAX_FILES = 5_000;
const DEFAULT_CLAIM_DERIVATION_BATCH_SIZE = 100;
const DEFAULT_OBSERVATION_QUALIFICATION_BATCH_SIZE = 100;
const VECTOR_RETRY_DELAY_MS = 5_000;
const DEDUP_PER_PAIR_TIMEOUT_MS = 5_000;

function vectorBatchSize(payload: Record<string, unknown>): number {
  const value = payload.limit;
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_VECTOR_BATCH_SIZE;
  return Math.min(100, Math.max(1, Math.floor(value)));
}

function retentionBatchSize(payload: Record<string, unknown>): number {
  const value = payload.limit;
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RETENTION_BATCH_SIZE;
  return Math.min(500, Math.max(1, Math.floor(value)));
}

function retentionCursor(payload: Record<string, unknown>): number {
  const value = payload.cursor;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function consolidationBatchSize(payload: Record<string, unknown>): number {
  const value = payload.limit;
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CONSOLIDATION_BATCH_SIZE;
  return Math.min(500, Math.max(1, Math.floor(value)));
}

function consolidationCursor(payload: Record<string, unknown>): number {
  const value = payload.cursor;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function codeGraphMaxFiles(payload: Record<string, unknown>): number {
  const value = payload.maxFiles;
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CODEGRAPH_MAX_FILES;
  return Math.min(20_000, Math.max(1, Math.floor(value)));
}

function claimDerivationBatchSize(payload: Record<string, unknown>): number {
  const value = payload.limit;
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CLAIM_DERIVATION_BATCH_SIZE;
  return Math.min(500, Math.max(1, Math.floor(value)));
}

function claimDerivationCursor(payload: Record<string, unknown>): number {
  const value = payload.cursor;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function observationQualificationBatchSize(payload: Record<string, unknown>): number {
  const value = payload.limit;
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_OBSERVATION_QUALIFICATION_BATCH_SIZE;
  return Math.min(500, Math.max(1, Math.floor(value)));
}

function observationQualificationCursor(payload: Record<string, unknown>): number {
  const value = payload.cursor;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function observationId(payload: Record<string, unknown>): number | undefined {
  const value = payload.observationId;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function workspaceMode(payload: Record<string, unknown>): 'local' | 'versioned' | undefined {
  return payload.workspaceMode === 'local' || payload.workspaceMode === 'versioned'
    ? payload.workspaceMode
    : undefined;
}

async function loadWorkspaceForMaintenance(
  projectId: string,
  projectDir: string,
  mode?: 'local' | 'versioned',
) {
  const { loadKnowledgeWorkspace } = await import('../knowledge/workspace.js');
  if (mode) return loadKnowledgeWorkspace({ projectId, dataDir: projectDir, mode });
  const [versioned, local] = await Promise.all([
    loadKnowledgeWorkspace({ projectId, dataDir: projectDir, mode: 'versioned' }),
    loadKnowledgeWorkspace({ projectId, dataDir: projectDir, mode: 'local' }),
  ]);
  return versioned ?? local;
}

/**
 * Creates handlers for one initialized project runtime. The worker itself is
 * project-scoped so it never claims a different project's queued work.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function runAutomaticConsolidation(
  projectId: string,
  projectDir: string,
  options: { afterId: number; limit: number },
): Promise<{ nextCursor?: number }> {
  const { isLLMEnabled } = await import('../llm/provider.js');
  if (!isLLMEnabled()) {
    const { executeConsolidation } = await import('../memory/consolidation.js');
    const result = await executeConsolidation(projectDir, projectId, {
      threshold: 0.55,
      afterId: options.afterId,
      limit: options.limit,
    });
    return result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor };
  }

  const [{ getObservationStore }, { deduplicateMemory }] = await Promise.all([
    import('../store/obs-store.js'),
    import('../llm/memory-manager.js'),
  ]);
  const store = getObservationStore();
  const page = await store.loadByProject(projectId, {
    status: 'active',
    afterId: options.afterId,
    limit: options.limit + 1,
  });
  const hasMore = page.length > options.limit;
  const allObservations = hasMore ? page.slice(0, options.limit) : page;
  const nextCursor = hasMore && allObservations.length > 0
    ? allObservations[allObservations.length - 1].id
    : undefined;
  if (allObservations.length <= 10) {
    return nextCursor === undefined ? {} : { nextCursor };
  }

  const grouped = new Map<string, typeof allObservations>();
  for (const observation of allObservations) {
    const key = `${observation.entityName}::${observation.type}`;
    const group = grouped.get(key) ?? [];
    group.push(observation);
    grouped.set(key, group);
  }

  const toResolve: number[] = [];
  const maxDedupCalls = 15;
  let dedupCalls = 0;
  for (const group of grouped.values()) {
    if (group.length < 2 || dedupCalls >= maxDedupCalls) continue;
    group.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    for (let index = 0; index < group.length - 1 && index < 3 && dedupCalls < maxDedupCalls; index++) {
      try {
        dedupCalls++;
        const older = group[index];
        const newer = group[index + 1];
        const decision = await withTimeout(
          deduplicateMemory(
            { title: newer.title, narrative: newer.narrative, facts: newer.facts },
            [{ id: older.id, title: older.title, narrative: older.narrative, facts: older.facts.join('\n') }],
          ),
          DEDUP_PER_PAIR_TIMEOUT_MS,
          `Dedup pair #${older.id}<->#${newer.id}`,
        );
        if (decision && (decision.action === 'UPDATE' || decision.action === 'NONE')) {
          toResolve.push(decision.action === 'UPDATE' ? older.id : newer.id);
        } else if (decision?.action === 'DELETE' && decision.targetId) {
          toResolve.push(decision.targetId);
        }
      } catch {
        // One slow or malformed LLM decision must not abandon the maintenance job.
      }
    }
  }
  if (toResolve.length > 0) {
    await store.atomic(async (tx) => {
      await Promise.all(
        [...new Set(toResolve)].map((id) => tx.setStatus(id, 'resolved', 'active')),
      );
    });
  }
  return nextCursor === undefined ? {} : { nextCursor };
}

export function createProjectMaintenanceHandler(
  projectId: string,
  projectDir: string,
  projectRoot?: string,
  options: { maintenanceQueue?: MaintenanceQueue } = {},
): MaintenanceJobHandler {
  return async (job): Promise<MaintenanceJobRunResult> => {
    if (job.projectId !== projectId) {
      return { action: 'reschedule', delayMs: VECTOR_RETRY_DELAY_MS };
    }

    if (job.kind === 'retention-archive') {
      const { archiveExpiredBatch } = await import('../memory/retention.js');
      const limit = retentionBatchSize(job.payload);
      const result = await archiveExpiredBatch(projectDir, {
        projectId,
        afterId: retentionCursor(job.payload),
        limit,
      });
      if (result.nextCursor !== undefined) {
        return {
          action: 'reschedule',
          delayMs: 0,
          resetAttempts: true,
          payload: { cursor: result.nextCursor, limit },
        };
      }
      return { action: 'complete' };
    }

    if (job.kind === 'consolidation') {
      const limit = consolidationBatchSize(job.payload);
      const result = await runAutomaticConsolidation(projectId, projectDir, {
        afterId: consolidationCursor(job.payload),
        limit,
      });
      if (result.nextCursor !== undefined) {
        return {
          action: 'reschedule',
          delayMs: 0,
          resetAttempts: true,
          payload: { cursor: result.nextCursor, limit },
        };
      }
      return { action: 'complete' };
    }

    if (job.kind === 'codegraph-refresh') {
      if (!projectRoot) {
        throw new Error(`CodeGraph refresh requires a project root for ${projectId}`);
      }
      const [
        { CodeGraphStore },
        { refreshProjectLite },
        { backfillMissingObservationCodeRefs },
        { getObservationStore },
        { getResolvedConfig },
      ] = await Promise.all([
        import('../codegraph/store.js'),
        import('../codegraph/lite-provider.js'),
        import('../codegraph/binder.js'),
        import('../store/obs-store.js'),
        import('../config/resolved-config.js'),
      ]);
      const store = new CodeGraphStore();
      await store.init(projectDir);
      const codegraphConfig = getResolvedConfig({ projectRoot }).codegraph;
      await refreshProjectLite(store, {
        projectId,
        projectRoot,
        exclude: codegraphConfig.excludePatterns,
        maxFiles: codeGraphMaxFiles(job.payload),
        maxFileBytes: codegraphConfig.maxFileBytes,
      });
      const activeObservations = await getObservationStore().loadByProject(projectId, { status: 'active' });
      await backfillMissingObservationCodeRefs(store, activeObservations);
      const snapshot = store.latestSnapshot(projectId);
      enqueueClaimRequalification({
        projectId,
        dataDir: projectDir,
        source: 'codegraph-refresh',
        ...(snapshot?.id ? { snapshotId: snapshot.id } : {}),
        ...(options.maintenanceQueue ? { queue: options.maintenanceQueue } : {}),
      });
      enqueueObservationQualification({
        projectId,
        dataDir: projectDir,
        source: 'codegraph-refresh',
        ...(options.maintenanceQueue ? { queue: options.maintenanceQueue } : {}),
      });
      return { action: 'complete' };
    }

    if (job.kind === 'observation-qualify') {
      const [
        { CodeGraphStore },
        { bindObservationToCode },
        { getObservationStore },
        { qualifyCandidateFromCurrentCode },
        { updateObservationAdmission },
      ] = await Promise.all([
        import('../codegraph/store.js'),
        import('../codegraph/binder.js'),
        import('../store/obs-store.js'),
        import('../memory/admission.js'),
        import('../memory/observations.js'),
      ]);
      const codeStore = new CodeGraphStore();
      await codeStore.init(projectDir);
      const limit = observationQualificationBatchSize(job.payload);
      const page = await getObservationStore().loadByProject(projectId, {
        status: 'active',
        afterId: observationQualificationCursor(job.payload),
        limit: limit + 1,
      });
      const hasMore = page.length > limit;
      const observations = hasMore ? page.slice(0, limit) : page;
      const indexedAtMs = Date.parse(codeStore.status(projectId).indexedAt ?? '');

      for (const observation of observations) {
        if (observation.admissionState !== 'candidate') continue;
        // A candidate may only earn delivery after a Code Memory scan that
        // happened at or after it was captured. A stale snapshot is evidence
        // about an earlier project state, not a reason to inject this record.
        if (!Number.isFinite(indexedAtMs) || indexedAtMs < Date.parse(observation.createdAt)) continue;
        await bindObservationToCode(codeStore, observation);
        const currentCodeReferenceCount = codeStore
          .listObservationRefs(projectId, observation.id)
          .filter((reference) => reference.status === 'current')
          .length;
        const qualification = qualifyCandidateFromCurrentCode({
          observation,
          currentCodeReferenceCount,
        });
        if (!qualification) continue;
        await updateObservationAdmission({
          observationId: observation.id,
          projectId,
          expectedState: 'candidate',
          ...qualification,
        });
      }

      if (hasMore && observations.length > 0) {
        return {
          action: 'reschedule',
          delayMs: 0,
          resetAttempts: true,
          payload: {
            ...job.payload,
            cursor: observations[observations.length - 1].id,
            limit,
          },
        };
      }
      return { action: 'complete' };
    }

    if (job.kind === 'claim-derive') {
      const id = observationId(job.payload);
      if (!id) throw new Error('Claim derivation requires a positive observationId');
      const [
        { CodeGraphStore },
        { ClaimStore },
        { bindObservationToCode },
        { deriveLowRiskClaimsFromObservation },
        { getObservationStore },
      ] = await Promise.all([
        import('../codegraph/store.js'),
        import('../knowledge/claim-store.js'),
        import('../codegraph/binder.js'),
        import('../knowledge/claims.js'),
        import('../store/obs-store.js'),
      ]);
      const observation = await getObservationStore().getById(id);
      if (!observation || observation.projectId !== projectId) return { action: 'complete' };
      const codeStore = new CodeGraphStore();
      const claimStore = new ClaimStore();
      await Promise.all([codeStore.init(projectDir), claimStore.init(projectDir)]);
      await bindObservationToCode(codeStore, observation);
      const derived = deriveLowRiskClaimsFromObservation(claimStore, observation, codeStore);
      if (derived.length > 0) {
        enqueueKnowledgeFollowups({
          projectId,
          dataDir: projectDir,
          source: 'claim-derive:' + id,
          includeCompile: true,
          ...(options.maintenanceQueue ? { queue: options.maintenanceQueue } : {}),
        });
      }
      return { action: 'complete' };
    }

    if (job.kind === 'claim-requalification') {
      const [
        { CodeGraphStore },
        { ClaimStore },
        { bindObservationToCode },
        { deriveLowRiskClaimsFromObservation, requalifyClaimsForCodeState },
        { getObservationStore },
      ] = await Promise.all([
        import('../codegraph/store.js'),
        import('../knowledge/claim-store.js'),
        import('../codegraph/binder.js'),
        import('../knowledge/claims.js'),
        import('../store/obs-store.js'),
      ]);
      const codeStore = new CodeGraphStore();
      const claimStore = new ClaimStore();
      await Promise.all([codeStore.init(projectDir), claimStore.init(projectDir)]);
      const limit = claimDerivationBatchSize(job.payload);
      const observations = await getObservationStore().loadByProject(projectId, {
        status: 'active',
        afterId: claimDerivationCursor(job.payload),
        limit,
      });
      let derivedCount = 0;
      for (const observation of observations) {
        await bindObservationToCode(codeStore, observation);
        derivedCount += deriveLowRiskClaimsFromObservation(claimStore, observation, codeStore).length;
      }
      requalifyClaimsForCodeState(claimStore, codeStore, projectId);
      if (observations.length === limit) {
        return {
          action: 'reschedule',
          delayMs: 0,
          resetAttempts: true,
          payload: {
            ...job.payload,
            cursor: observations[observations.length - 1].id,
            limit,
          },
        };
      }
      enqueueKnowledgeFollowups({
        projectId,
        dataDir: projectDir,
        source: 'claim-requalification',
        includeCompile: derivedCount > 0,
        ...(options.maintenanceQueue ? { queue: options.maintenanceQueue } : {}),
      });
      return { action: 'complete' };
    }

    if (job.kind === 'knowledge-compile') {
      const workspace = await loadWorkspaceForMaintenance(projectId, projectDir, workspaceMode(job.payload));
      if (!workspace) return { action: 'complete' };
      if (workspace.mode === 'versioned' && job.payload.allowVersionedWrite !== true) {
        return { action: 'complete' };
      }
      const [{ ClaimStore }, { compileKnowledgeWorkspace }] = await Promise.all([
        import('../knowledge/claim-store.js'),
        import('../knowledge/wiki.js'),
      ]);
      const claims = new ClaimStore();
      await claims.init(projectDir);
      await compileKnowledgeWorkspace({ workspace, claims });
      enqueueKnowledgeFollowups({
        projectId,
        dataDir: projectDir,
        source: 'knowledge-compile',
        ...(options.maintenanceQueue ? { queue: options.maintenanceQueue } : {}),
      });
      return { action: 'complete' };
    }

    if (job.kind === 'workflow-index') {
      const workspace = await loadWorkspaceForMaintenance(projectId, projectDir, workspaceMode(job.payload));
      if (!workspace) return { action: 'complete' };
      const { syncCanonicalWorkflows } = await import('../knowledge/workflows.js');
      await syncCanonicalWorkflows(workspace);
      return { action: 'complete' };
    }

    if (job.kind === 'knowledge-lint') {
      const workspace = await loadWorkspaceForMaintenance(projectId, projectDir, workspaceMode(job.payload));
      if (!workspace) return { action: 'complete' };
      const [
        { ClaimStore },
        { CodeGraphStore },
        { lintKnowledgeWorkspace },
      ] = await Promise.all([
        import('../knowledge/claim-store.js'),
        import('../codegraph/store.js'),
        import('../knowledge/wiki.js'),
      ]);
      const claims = new ClaimStore();
      const codeStore = new CodeGraphStore();
      await Promise.all([claims.init(projectDir), codeStore.init(projectDir)]);
      await lintKnowledgeWorkspace({ workspace, claims, codeStore });
      return { action: 'complete' };
    }

    if (job.kind !== 'vector-backfill') {
      throw new Error(`No runtime handler is registered for maintenance job: ${job.kind}`);
    }

    const { isEmbeddingExplicitlyDisabled } = await import('../embedding/provider.js');
    if (isEmbeddingExplicitlyDisabled()) return { action: 'complete' };

    const { backfillVectorEmbeddings, getVectorStatus } = await import('../memory/observations.js');
    const before = getVectorStatus(projectId);
    if (before.missing === 0) return { action: 'complete' };

    const result = await backfillVectorEmbeddings({
      projectId,
      limit: vectorBatchSize(job.payload),
    });
    const after = getVectorStatus(projectId);
    if (after.missing === 0) return { action: 'complete' };

    if (result.failed > 0 && result.succeeded === 0) {
      throw new Error(`vector backfill made no progress (${result.failed}/${result.attempted} failed)`);
    }

    return {
      action: 'reschedule',
      delayMs: result.attempted === 0 ? VECTOR_RETRY_DELAY_MS : 0,
      resetAttempts: result.succeeded > 0,
    };
  };
}

/**
 * Keep vector writes with the active in-memory search index. Everything that
 * can scan disk or consolidate a large corpus runs in a separate process so
 * an MCP request never shares its event loop with maintenance work.
 */
export function createProjectMaintenanceDispatcher(
  projectId: string,
  projectDir: string,
  projectRoot: string,
  isolatedRunner: typeof runMaintenanceInChildProcess = runMaintenanceInChildProcess,
): MaintenanceJobHandler {
  const inProcessHandler = createProjectMaintenanceHandler(projectId, projectDir, projectRoot);
  return async (job): Promise<MaintenanceJobRunResult> => {
    if (job.kind === 'vector-backfill') {
      return (await inProcessHandler(job)) ?? { action: 'complete' };
    }
    return isolatedRunner({ job, projectRoot, dataDir: projectDir });
  };
}
