import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { refreshProjectLite } from '../../src/codegraph/lite-provider.js';
import { buildSemanticContext } from '../../src/codegraph/semantic-context.js';
import { CodeGraphStore } from '../../src/codegraph/store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let root: string | undefined;

afterEach(() => {
  closeAllDatabases();
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe('internal semantic context', () => {
  it('returns only task-relevant symbols and source-backed relations', async () => {
    root = join(tmpdir(), `memorix-semantic-context-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'auth.ts'), [
      "import { validate } from './validate.js';",
      'export function authenticate(token: string) { return validate(token); }',
    ].join('\n'));
    writeFileSync(join(root, 'src', 'validate.ts'), 'export function validate(token: string) { return token.length > 0; }\n');
    writeFileSync(join(root, 'src', 'billing.ts'), 'export function charge() { return true; }\n');

    const store = new CodeGraphStore();
    await store.init(root);
    await refreshProjectLite(store, { projectId: 'fixture/context', projectRoot: root });

    const outline = buildSemanticContext({
      store,
      projectId: 'fixture/context',
      task: 'explain authenticate validation',
      preferredPaths: ['src/auth.ts'],
    });

    expect(outline).toBeDefined();
    expect(outline?.provider).toBe('semantic');
    expect(outline?.entryPoints.map(item => item.name)).toContain('authenticate');
    expect(outline?.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'calls', from: expect.objectContaining({ name: 'authenticate' }), to: expect.objectContaining({ name: 'validate' }) }),
    ]));
    expect(outline?.relatedFiles).toContain('src/auth.ts');
    expect(outline?.relatedFiles).not.toContain('src/billing.ts');
  });
});
