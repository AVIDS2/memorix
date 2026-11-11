import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCodeGraphDerivedView } from '../../src/codegraph/derived-view.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

describe('CodeGraph derived view', () => {
  let dataDir = '';
  let projectRoot = '';

  afterEach(async () => {
    closeAllDatabases();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
  });

  it('exposes refresh, status, rebuild, compact, and close lifecycle', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'memorix-codegraph-view-data-'));
    projectRoot = await mkdtemp(path.join(tmpdir(), 'memorix-codegraph-view-project-'));
    await writeFile(path.join(projectRoot, 'auth.ts'), 'export function verifyToken() { return true; }\n');
    const view = createCodeGraphDerivedView(dataDir);

    expect((await view.status()).state).toBe('missing');
    await view.refresh({ projectId: 'org/repo', projectRoot });
    expect((await view.status()).state).toBe('ready');
    expect((await view.status()).rowCount).toBe(1);
    expect(await view.rebuild()).toBe(true);
    await view.compact();
    await view.close();
    expect((await view.status()).state).toBe('missing');
  });
});
