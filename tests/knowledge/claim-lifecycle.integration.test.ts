import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: async () => null,
  isVectorSearchAvailable: async () => false,
  isEmbeddingExplicitlyDisabled: () => true,
  resetProvider: () => {},
}));

import { refreshProjectLite } from '../../src/codegraph/lite-provider.js';
import { CodeGraphStore } from '../../src/codegraph/store.js';
import { ClaimStore } from '../../src/knowledge/claim-store.js';
import { reviewClaim } from '../../src/knowledge/claims.js';
import { initObservations, storeObservation } from '../../src/memory/observations.js';
import { MaintenanceJobStore, MaintenanceJobWorker } from '../../src/runtime/maintenance-jobs.js';
import { createProjectMaintenanceHandler } from '../../src/runtime/project-maintenance.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { resetDb } from '../../src/store/orama-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let sandbox = '';
let projectRoot = '';
let dataDir = '';

beforeEach(async () => {
  sandbox = await fs.mkdtemp(path.join(tmpdir(), 'memorix-claim-lifecycle-'));
  projectRoot = path.join(sandbox, 'repo');
  dataDir = path.join(sandbox, 'data');
  await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, 'src', 'auth.ts'),
    'export function createSession() { return true; }\n',
    'utf8',
  );
  await resetDb();
  await initObservations(dataDir);
});

afterEach(async () => {
  resetObservationStore();
  closeAllDatabases();
  await resetDb();
  if (sandbox) await fs.rm(sandbox, { recursive: true, force: true });
});

describe('claim lifecycle integration', () => {
  it('keeps an explicit-memory claim reviewable until evidence is checked, then downgrades it after a bound symbol changes', async () => {
    const code = new CodeGraphStore();
    await code.init(dataDir);
    const first = await refreshProjectLite(code, {
      projectId: 'org/repo',
      projectRoot,
    });

    const { observation } = await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'Use createSession signed cookies',
      narrative: 'The auth flow uses createSession in src/auth.ts.',
      filesModified: ['src/auth.ts'],
      projectId: 'org/repo',
      source: 'manual',
      sourceDetail: 'explicit',
    });
    const claims = new ClaimStore();
    await claims.init(dataDir);
    const queue = new MaintenanceJobStore(dataDir);
    const pendingDerivation = queue.list({ projectId: 'org/repo' })
      .find(job => job.kind === 'claim-derive');

    expect(claims.listClaims('org/repo')).toEqual([]);
    expect(pendingDerivation).toMatchObject({
      kind: 'claim-derive',
      payload: { observationId: observation.id },
    });

    const worker = new MaintenanceJobWorker(
      queue,
      createProjectMaintenanceHandler('org/repo', dataDir, projectRoot),
      { workerId: 'claim-lifecycle-test' },
    );
    await worker.runOnce();

    const claim = claims.listClaims('org/repo')[0];
    const evidence = claims.listEvidence(claim.id);

    expect(claim).toMatchObject({
      subject: 'auth',
      predicate: 'decision',
      status: 'active',
      reviewState: 'needs-review',
    });
    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceKind: 'observation',
        evidenceId: 'observation:' + observation.id,
      }),
      expect.objectContaining({
        evidenceKind: 'code',
        snapshotId: first.snapshot.id,
      }),
    ]));
    expect(reviewClaim(claims, {
      claimId: claim.id,
      reviewState: 'approved',
      detail: 'Checked the linked current code snapshot before publication.',
    })).toMatchObject({ reviewState: 'approved', status: 'active' });

    await fs.writeFile(
      path.join(projectRoot, 'src', 'auth.ts'),
      'export function createToken() { return "new"; }\n',
      'utf8',
    );
    await createProjectMaintenanceHandler('org/repo', dataDir, projectRoot)({
      ...pendingDerivation!,
      id: 'codegraph-refresh-job',
      kind: 'codegraph-refresh',
      dedupeKey: 'codegraph-refresh',
      payload: {},
    });
    const requalification = queue.list({ projectId: 'org/repo' })
      .find(job => job.kind === 'claim-requalification');
    expect(requalification).toBeDefined();
    await createProjectMaintenanceHandler('org/repo', dataDir, projectRoot)(requalification!);

    expect(claims.getClaim(claim.id)).toMatchObject({
      status: 'unknown',
      reviewState: 'needs-review',
    });
  });
});
