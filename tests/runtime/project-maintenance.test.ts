import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runMaintenanceInChildProcess } = vi.hoisted(() => ({
  runMaintenanceInChildProcess: vi.fn(),
}));

const isEmbeddingExplicitlyDisabled = vi.fn();
const backfillVectorEmbeddings = vi.fn();
const getVectorStatus = vi.fn();
const archiveExpiredBatch = vi.fn();
const codeStoreInit = vi.fn();
const latestSnapshot = vi.fn();
const CodeGraphStore = vi.fn(function CodeGraphStoreMock() {
  return { init: codeStoreInit, latestSnapshot };
});
const refreshProjectLite = vi.fn();
const backfillMissingObservationCodeRefs = vi.fn();
const getResolvedConfig = vi.fn();
const loadByProject = vi.fn();
const getById = vi.fn();
const getObservationStore = vi.fn(() => ({ loadByProject, getById }));
const claimStoreInit = vi.fn();
const ClaimStore = vi.fn(function ClaimStoreMock() {
  return { init: claimStoreInit };
});
const bindObservationToCode = vi.fn();
const deriveLowRiskClaimsFromObservation = vi.fn();
const requalifyClaimsForCodeState = vi.fn();
const queueEnqueue = vi.fn();

vi.mock('../../src/embedding/provider.js', () => ({
  isEmbeddingExplicitlyDisabled,
}));

vi.mock('../../src/memory/observations.js', () => ({
  backfillVectorEmbeddings,
  getVectorStatus,
}));

vi.mock('../../src/memory/retention.js', () => ({
  archiveExpiredBatch,
}));

vi.mock('../../src/codegraph/store.js', () => ({ CodeGraphStore }));
vi.mock('../../src/codegraph/lite-provider.js', () => ({ refreshProjectLite }));
vi.mock('../../src/codegraph/binder.js', () => ({
  backfillMissingObservationCodeRefs,
  bindObservationToCode,
}));
vi.mock('../../src/store/obs-store.js', () => ({ getObservationStore }));
vi.mock('../../src/config/resolved-config.js', () => ({ getResolvedConfig }));
vi.mock('../../src/runtime/isolated-maintenance.js', () => ({ runMaintenanceInChildProcess }));
vi.mock('../../src/knowledge/claim-store.js', () => ({ ClaimStore }));
vi.mock('../../src/knowledge/claims.js', () => ({
  deriveLowRiskClaimsFromObservation,
  requalifyClaimsForCodeState,
}));

import { createProjectMaintenanceDispatcher, createProjectMaintenanceHandler } from '../../src/runtime/project-maintenance.js';
import type { MaintenanceJob } from '../../src/runtime/maintenance-jobs.js';

function makeJob(overrides: Partial<MaintenanceJob> = {}): MaintenanceJob {
  return {
    id: 'job-1',
    projectId: 'project-a',
    kind: 'vector-backfill',
    dedupeKey: 'vectors',
    payload: { limit: 2 },
    status: 'running',
    attempts: 1,
    maxAttempts: 8,
    runAfter: 1_000,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe('createProjectMaintenanceHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isEmbeddingExplicitlyDisabled.mockReturnValue(false);
    getResolvedConfig.mockReturnValue({ codegraph: { excludePatterns: ['generated/**'] } });
    getObservationStore.mockReturnValue({ loadByProject, getById });
    latestSnapshot.mockReturnValue({ id: 'snapshot-a' });
    queueEnqueue.mockReset();
  });

  it('processes vector work in the requested bounded batch and reschedules remaining work', async () => {
    getVectorStatus
      .mockReturnValueOnce({ missing: 3 })
      .mockReturnValueOnce({ missing: 1 });
    backfillVectorEmbeddings.mockResolvedValue({ attempted: 2, succeeded: 2, failed: 0 });

    const result = await createProjectMaintenanceHandler('project-a', 'C:/memorix-data')(makeJob());

    expect(backfillVectorEmbeddings).toHaveBeenCalledWith({ projectId: 'project-a', limit: 2 });
    expect(result).toEqual({ action: 'reschedule', delayMs: 0, resetAttempts: true });
  });

  it('completes vector work immediately when embeddings are explicitly disabled', async () => {
    isEmbeddingExplicitlyDisabled.mockReturnValue(true);

    const result = await createProjectMaintenanceHandler('project-a', 'C:/memorix-data')(makeJob());

    expect(result).toEqual({ action: 'complete' });
    expect(backfillVectorEmbeddings).not.toHaveBeenCalled();
  });

  it('continues retention through a durable cursor instead of scanning from the beginning', async () => {
    archiveExpiredBatch.mockResolvedValue({ archived: 1, scanned: 25, nextCursor: 50 });

    const result = await createProjectMaintenanceHandler('project-a', 'C:/memorix-data')(
      makeJob({
        kind: 'retention-archive',
        payload: { cursor: 25, limit: 25 },
      }),
    );

    expect(archiveExpiredBatch).toHaveBeenCalledWith('C:/memorix-data', {
      projectId: 'project-a',
      afterId: 25,
      limit: 25,
    });
    expect(result).toEqual({
      action: 'reschedule',
      delayMs: 0,
      resetAttempts: true,
      payload: { cursor: 50, limit: 25 },
    });
  });

  it('refreshes and binds Code Memory through the registered maintenance handler', async () => {
    const observations = [
      { id: 1, projectId: 'project-a', title: 'Current', narrative: '', createdAt: '2026-01-01T00:00:00.000Z', status: 'active' },
      { id: 2, projectId: 'project-b', title: 'Other project', narrative: '', createdAt: '2026-01-01T00:00:00.000Z', status: 'active' },
      { id: 3, projectId: 'project-a', title: 'Archived', narrative: '', createdAt: '2026-01-01T00:00:00.000Z', status: 'archived' },
    ];
    loadByProject.mockResolvedValue([observations[0]]);
    refreshProjectLite.mockResolvedValue({ changedFiles: 1 });
    backfillMissingObservationCodeRefs.mockResolvedValue({ observationsBackfilled: 1, refsBackfilled: 2 });

    const result = await createProjectMaintenanceHandler(
      'project-a',
      'C:/memorix-data',
      'C:/workspace/project-a',
      { maintenanceQueue: { enqueue: queueEnqueue } },
    )(makeJob({ kind: 'codegraph-refresh', payload: { maxFiles: 250 } }));

    expect(codeStoreInit).toHaveBeenCalledWith('C:/memorix-data');
    expect(refreshProjectLite).toHaveBeenCalledWith(expect.anything(), {
      projectId: 'project-a',
      projectRoot: 'C:/workspace/project-a',
      exclude: ['generated/**'],
      maxFiles: 250,
    });
    expect(backfillMissingObservationCodeRefs).toHaveBeenCalledWith(
      expect.anything(),
      [observations[0]],
    );
    expect(loadByProject).toHaveBeenCalledWith('project-a', { status: 'active' });
    expect(queueEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'claim-requalification',
      projectId: 'project-a',
    }));
    expect(result).toEqual({ action: 'complete' });
  });

  it('derives an eligible observation through a durable maintenance job, then schedules reviewable knowledge updates', async () => {
    const observation = {
      id: 42,
      projectId: 'project-a',
      entityName: 'auth',
      type: 'decision',
      title: 'Use signed sessions',
      narrative: 'The auth service uses signed sessions.',
      facts: [],
      filesModified: ['src/auth.ts'],
      source: 'manual',
      sourceDetail: 'explicit',
      status: 'active',
      createdAt: '2026-07-17T00:00:00.000Z',
    };
    getById.mockResolvedValue(observation);
    bindObservationToCode.mockResolvedValue([]);
    deriveLowRiskClaimsFromObservation.mockReturnValue([{ id: 'claim-1' }]);

    const result = await createProjectMaintenanceHandler(
      'project-a',
      'C:/memorix-data',
      'C:/workspace/project-a',
      { maintenanceQueue: { enqueue: queueEnqueue } },
    )(makeJob({
      kind: 'claim-derive' as any,
      payload: { observationId: 42 },
    }));

    expect(claimStoreInit).toHaveBeenCalledWith('C:/memorix-data');
    expect(bindObservationToCode).toHaveBeenCalledWith(expect.anything(), observation);
    expect(deriveLowRiskClaimsFromObservation).toHaveBeenCalledWith(
      expect.anything(),
      observation,
      expect.anything(),
    );
    expect(queueEnqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'knowledge-compile' }));
    expect(result).toEqual({ action: 'complete' });
  });

  it('keeps vector backfill in the live process and moves disk-heavy work into an isolated runner', async () => {
    runMaintenanceInChildProcess.mockResolvedValue({ action: 'complete' });
    const dispatcher = createProjectMaintenanceDispatcher(
      'project-a',
      'C:/memorix-data',
      'C:/workspace/project-a',
    );

    const result = await dispatcher(makeJob({ kind: 'codegraph-refresh' }));

    expect(result).toEqual({ action: 'complete' });
    expect(runMaintenanceInChildProcess).toHaveBeenCalledWith({
      job: makeJob({ kind: 'codegraph-refresh' }),
      projectRoot: 'C:/workspace/project-a',
      dataDir: 'C:/memorix-data',
    });
    expect(refreshProjectLite).not.toHaveBeenCalled();
  });

  it('moves claim derivation into the isolated maintenance lane too', async () => {
    runMaintenanceInChildProcess.mockResolvedValue({ action: 'complete' });
    const dispatcher = createProjectMaintenanceDispatcher(
      'project-a',
      'C:/memorix-data',
      'C:/workspace/project-a',
    );
    const claimJob = makeJob({ kind: 'claim-derive' as any, payload: { observationId: 42 } });

    await expect(dispatcher(claimJob)).resolves.toEqual({ action: 'complete' });
    expect(runMaintenanceInChildProcess).toHaveBeenCalledWith({
      job: claimJob,
      projectRoot: 'C:/workspace/project-a',
      dataDir: 'C:/memorix-data',
    });
  });
});
