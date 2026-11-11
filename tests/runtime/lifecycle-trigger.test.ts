import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  enqueueClaimRequalification,
  enqueueCodegraphRefresh,
} from '../../src/runtime/lifecycle.js';
import { MaintenanceJobStore } from '../../src/runtime/maintenance-jobs.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let dataDir = '';

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-lifecycle-trigger-'));
});

afterEach(async () => {
  closeAllDatabases();
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('durable lifecycle triggers', () => {
  it('coalesces fresh scan requests into one job with the newest source payload', () => {
    enqueueCodegraphRefresh({
      dataDir,
      projectId: 'project-a',
      source: 'startup',
      maxFiles: 100,
    });
    enqueueCodegraphRefresh({
      dataDir,
      projectId: 'project-a',
      source: 'hook',
      maxFiles: 500,
    });

    const jobs = new MaintenanceJobStore(dataDir).list({ projectId: 'project-a' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      kind: 'codegraph-refresh',
      dedupeKey: 'codegraph-refresh',
      payload: { source: 'hook', maxFiles: 500 },
    });
  });

  it('coalesces claim requalification by project instead of creating a full pass per snapshot', () => {
    enqueueClaimRequalification({
      dataDir,
      projectId: 'project-a',
      source: 'snapshot-a',
      snapshotId: 'snapshot-a',
    });
    enqueueClaimRequalification({
      dataDir,
      projectId: 'project-a',
      source: 'snapshot-b',
      snapshotId: 'snapshot-b',
    });

    const jobs = new MaintenanceJobStore(dataDir).list({ projectId: 'project-a' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      kind: 'claim-requalification',
      dedupeKey: 'claim-requalification',
      payload: { source: 'snapshot-b', snapshotId: 'snapshot-b' },
    });
  });
});
