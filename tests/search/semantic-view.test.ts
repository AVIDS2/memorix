import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSemanticDerivedView } from '../../src/search/semantic-view.js';
import { createSemanticIndexProfile, resetSemanticIndexRuntime } from '../../src/search/semantic-index.js';

describe('semantic derived-view contract', () => {
  let dataDir = '';
  afterEach(async () => {
    resetSemanticIndexRuntime();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('reports missing before refresh and ready after a persisted write', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-semantic-view-'));
    const view = createSemanticDerivedView(dataDir, createSemanticIndexProfile({ name: 'test', dimensions: 3 }));
    expect((await view.status()).state).toBe('missing');
    await view.refresh([{ observationId: 1, projectId: 'org/repo', status: 'active', vector: [1, 0, 0] }]);
    expect(await view.status()).toMatchObject({ state: 'ready', rowCount: 1 });
    await view.compact();
    await view.close();
  });
});
