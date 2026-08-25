import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../src/llm/provider.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/llm/provider.js')>('../../src/llm/provider.js');
  return {
    ...actual,
    initLLM: vi.fn(() => null),
    isLLMEnabled: vi.fn(() => false),
  };
});

import {
  DashboardMaintenanceError,
  executeCleanup,
  executeConsolidate,
  executeRetentionArchive,
  previewCleanup,
  previewConsolidate,
  previewDeduplicate,
  previewRetentionArchive,
} from '../../src/dashboard/maintenance.js';
import { setLLMConfig } from '../../src/llm/provider.js';
import { getObservationStore, initObservationStore, resetObservationStore } from '../../src/store/obs-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import type { Observation } from '../../src/types.js';

const PROJECT_ID = 'test/dashboard-maintenance';

function observation(id: number, title: string, overrides: Partial<Observation> = {}): Observation {
  return {
    id,
    entityName: 'auth',
    type: 'discovery',
    title,
    narrative: 'Use project-scoped evidence for this durable memory.',
    facts: ['project-scoped evidence'],
    filesModified: [],
    concepts: ['maintenance'],
    tokens: 12,
    createdAt: new Date(2026, 0, id).toISOString(),
    projectId: PROJECT_ID,
    status: 'active',
    ...overrides,
  };
}

describe('dashboard maintenance actions', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-dashboard-maintenance-'));
    await initObservationStore(dataDir);
    setLLMConfig(null);
  });

  afterEach(async () => {
    resetObservationStore();
    closeAllDatabases();
    setLLMConfig(null);
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  function context() {
    return {
      dataDir,
      projectId: PROJECT_ID,
      projectRoot: null,
      store: getObservationStore(),
    };
  }

  it('rejects a cleanup execution when candidates changed after preview', async () => {
    const store = getObservationStore();
    await store.insert(observation(1, 'Updated auth.ts'));
    const preview = await previewCleanup(context(), false);
    await store.insert(observation(2, 'Created session.ts'));

    await expect(executeCleanup(context(), preview.payload, preview.token))
      .rejects.toMatchObject<Partial<DashboardMaintenanceError>>({ status: 409 });
    expect(await store.getById(1)).toMatchObject({ status: 'active' });
  });

  it('previews and executes the existing consolidation engine', async () => {
    const store = getObservationStore();
    await store.insert(observation(1, 'Windows path separator bug', {
      narrative: 'Use path join because string path concatenation breaks on Windows.',
    }));
    await store.insert(observation(2, 'Windows path separator issue', {
      narrative: 'String path concatenation breaks on Windows so use path join.',
    }));

    const preview = await previewConsolidate(context());
    expect(preview.summary.clusters).toBe(1);
    expect(preview.summary.observations).toBe(2);

    const result = await executeConsolidate(context(), preview.payload, preview.token);
    expect(result.clustersFound).toBe(1);
    expect(result.observationsMerged).toBe(1);
  });

  it('previews and archives only current retention candidates', async () => {
    const store = getObservationStore();
    await store.insert(observation(1, 'Old contextual note', {
      createdAt: '2024-01-01T00:00:00.000Z',
      source: 'agent',
      valueCategory: 'contextual',
    }));

    const preview = await previewRetentionArchive(context());
    expect(preview.summary.archive).toBe(1);
    expect(preview.candidates).toMatchObject([{ id: 1, zone: 'archive-candidate' }]);

    const result = await executeRetentionArchive(context(), preview.payload, preview.token);
    expect(result.archived).toBe(1);
    expect(await store.getById(1)).toMatchObject({ status: 'archived' });
  });

  it('reports intelligent deduplication as unavailable without a memory LLM', async () => {
    const preview = await previewDeduplicate(context());
    expect(preview).toMatchObject({ available: false, action: 'deduplicate' });
  });
});
