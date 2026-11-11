import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CONTROL_PLANE_MAINTENANCE_KINDS,
  createControlPlaneMaintenanceHandler,
  createControlPlaneMaintenanceWorker,
} from '../../src/runtime/control-plane-maintenance.js';
import { MaintenanceJobStore, type MaintenanceJob } from '../../src/runtime/maintenance-jobs.js';
import { MaintenanceTargetStore } from '../../src/runtime/maintenance-targets.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-control-plane-'));
});

afterEach(async () => {
  closeAllDatabases();
  await fs.rm(dataDir, { recursive: true, force: true });
});

function makeJob(overrides: Partial<MaintenanceJob> = {}): MaintenanceJob {
  return {
    id: 'job-1',
    projectId: 'project-a',
    kind: 'codegraph-refresh',
    dedupeKey: 'graph',
    payload: { maxFiles: 100 },
    status: 'running',
    attempts: 1,
    maxAttempts: 8,
    runAfter: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('control-plane maintenance', () => {
  it('stores the latest local target without exposing it through the job payload', () => {
    const targets = new MaintenanceTargetStore(dataDir);
    targets.register({
      projectId: 'project-a',
      projectRoot: 'C:/workspace/old',
      dataDir,
      now: 1_000,
    });
    const registered = targets.register({
      projectId: 'project-a',
      projectRoot: 'C:/workspace/current',
      dataDir,
      now: 2_000,
    });

    expect(registered).toEqual({
      projectId: 'project-a',
      projectRoot: 'C:/workspace/current',
      dataDir,
      updatedAt: 2_000,
    });
    expect(targets.get('project-a')).toEqual(registered);
  });

  it('uses a registered target for isolated work and reschedules unknown projects', async () => {
    const targets = new MaintenanceTargetStore(dataDir);
    targets.register({ projectId: 'project-a', projectRoot: 'C:/workspace/project-a', dataDir });
    const runner = vi.fn().mockResolvedValue({ action: 'complete' as const });
    const handler = createControlPlaneMaintenanceHandler(dataDir, runner);

    await expect(handler(makeJob())).resolves.toEqual({ action: 'complete' });
    expect(runner).toHaveBeenCalledWith({
      job: makeJob(),
      projectRoot: 'C:/workspace/project-a',
      dataDir,
    });

    await expect(handler(makeJob({ projectId: 'missing-project' }))).resolves.toEqual({
      action: 'reschedule',
      delayMs: 30_000,
    });
  });

  it('claims only isolated job kinds and leaves vector work for the live MCP runtime', async () => {
    expect(CONTROL_PLANE_MAINTENANCE_KINDS).not.toContain('vector-backfill');
    expect(CONTROL_PLANE_MAINTENANCE_KINDS).toContain('claim-derive');
    const targets = new MaintenanceTargetStore(dataDir);
    targets.register({ projectId: 'project-a', projectRoot: 'C:/workspace/project-a', dataDir });
    const queue = new MaintenanceJobStore(dataDir);
    const vector = queue.enqueue({
      projectId: 'project-a',
      kind: 'vector-backfill',
      dedupeKey: 'vectors',
      now: 1_000,
    });
    const graph = queue.enqueue({
      projectId: 'project-a',
      kind: 'codegraph-refresh',
      dedupeKey: 'graph',
      now: 1_000,
    });
    const runner = vi.fn().mockResolvedValue({ action: 'complete' as const });
    const worker = createControlPlaneMaintenanceWorker(dataDir, {
      workerId: 'control-plane-test',
      isolatedRunner: runner,
    });

    await worker.runOnce(1_000);

    expect(queue.get(graph.id)?.status).toBe('completed');
    expect(queue.get(vector.id)?.status).toBe('pending');
    expect(runner).toHaveBeenCalledTimes(1);
  });
});
