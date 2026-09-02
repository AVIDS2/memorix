import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getCodeGraphDashboardStatus } from '../../src/codegraph/dashboard.js';
import { refreshProjectLite } from '../../src/codegraph/lite-provider.js';
import { CodeGraphStore } from '../../src/codegraph/store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let root: string | undefined;

afterEach(() => {
  closeAllDatabases();
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe('CodeGraph dashboard projection', () => {
  it('reports semantic coverage separately from the legacy memory graph', async () => {
    root = join(tmpdir(), `memorix-codegraph-dashboard-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'entry.ts'), 'export function entry() { return true; }\n');

    const store = new CodeGraphStore();
    await store.init(root);
    await refreshProjectLite(store, { projectId: 'fixture/dashboard', projectRoot: root });

    const status = await getCodeGraphDashboardStatus(root, 'fixture/dashboard');
    expect(status).toMatchObject({
      state: 'ready',
      provider: 'lite',
      files: 1,
      semantic: { files: 1, symbols: 1, parserErrors: 0 },
    });
    expect(status.snapshot?.incomplete).toBe(false);
  });
});
