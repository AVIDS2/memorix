import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { indexProjectLite } from '../../src/codegraph/lite-provider.js';

const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/workset-evaluation');

function fixturePath(name: string): string {
  return path.join(fixtureRoot, name);
}

describe('1.2 evaluation fixture corpus', () => {
  it('indexes TypeScript, Python, and Go fixture repositories without a provider network call', async () => {
    const [typescript, python, go] = await Promise.all([
      indexProjectLite({ projectId: 'fixture/typescript', projectRoot: fixturePath('typescript-auth') }),
      indexProjectLite({ projectId: 'fixture/python', projectRoot: fixturePath('python-worker') }),
      indexProjectLite({ projectId: 'fixture/go', projectRoot: fixturePath('go-service') }),
    ]);

    expect(typescript.files.map(file => file.path).sort()).toEqual([
      'src/auth.ts',
      'tests/auth.test.ts',
    ]);
    expect(typescript.symbols.map(symbol => symbol.name)).toEqual(expect.arrayContaining([
      'validateToken',
      'requireAuthenticatedUser',
    ]));
    expect(python.files.map(file => file.path)).toEqual(['app/worker.py']);
    expect(python.symbols.map(symbol => symbol.name)).toContain('dispatch_job');
    expect(go.files.map(file => file.path)).toEqual(['internal/health/health.go']);
    expect(go.symbols.map(symbol => symbol.name)).toContain('Check');
  });

  it('records docs-only, deleted-symbol, and incomplete-scan boundaries explicitly', async () => {
    const docsOnly = await indexProjectLite({
      projectId: 'fixture/docs-only',
      projectRoot: fixturePath('docs-only'),
    });
    const incomplete = await indexProjectLite({
      projectId: 'fixture/incomplete-scan',
      projectRoot: fixturePath('incomplete-scan'),
      maxFileBytes: 10,
    });
    const deletedSymbolPath = path.join(fixturePath('deleted-symbol'), 'src/legacy-router.ts');

    expect(docsOnly.files).toEqual([]);
    expect(incomplete.files).toEqual([]);
    expect(incomplete.skippedOversizedFiles).toBe(1);
    expect(existsSync(deletedSymbolPath)).toBe(false);
  });
});
