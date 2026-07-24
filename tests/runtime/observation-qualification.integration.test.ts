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

import { getObservation, initObservations, storeObservation } from '../../src/memory/observations.js';
import { MaintenanceJobStore } from '../../src/runtime/maintenance-jobs.js';
import { createProjectMaintenanceHandler } from '../../src/runtime/project-maintenance.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { resetDb } from '../../src/store/orama-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let sandbox = '';
let projectRoot = '';
let dataDir = '';

beforeEach(async () => {
  sandbox = await fs.mkdtemp(path.join(tmpdir(), 'memorix-observation-qualification-'));
  projectRoot = path.join(sandbox, 'repo');
  dataDir = path.join(sandbox, 'data');
  await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, 'src', 'auth.ts'),
    'export function verifySession(token: string) { return token.length > 0; }\n',
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

describe('automatic observation qualification', () => {
  it('keeps a hook capture out of automatic delivery until a later Code Memory scan binds it', async () => {
    const { observation } = await storeObservation({
      entityName: 'auth',
      type: 'what-changed',
      title: 'Hook observed session verification edit',
      narrative: 'Changed src/auth.ts to update session verification.',
      filesModified: ['src/auth.ts'],
      projectId: 'org/repo',
      source: 'agent',
      sourceDetail: 'hook',
      valueCategory: 'contextual',
      admissionState: 'candidate',
      admissionReason: 'file mutation awaits Code Memory qualification',
    });

    expect(getObservation(observation.id, 'org/repo')?.admissionState).toBe('candidate');

    const queue = new MaintenanceJobStore(dataDir);
    const handler = createProjectMaintenanceHandler('org/repo', dataDir, projectRoot);
    await handler({
      id: 'refresh-code-memory',
      projectId: 'org/repo',
      kind: 'codegraph-refresh',
      dedupeKey: 'codegraph-refresh',
      payload: {},
      status: 'running',
      attempts: 1,
      maxAttempts: 8,
      runAfter: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const qualification = queue.list({ projectId: 'org/repo' })
      .find((job) => job.kind === 'observation-qualify');
    expect(qualification).toBeDefined();
    await handler(qualification!);

    expect(getObservation(observation.id, 'org/repo')).toMatchObject({
      admissionState: 'qualified',
    });
  });
});
