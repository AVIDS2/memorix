import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { indexProjectLite } from '../../src/codegraph/lite-provider.js';
import { buildTypeScriptSemanticIndex } from '../../src/codegraph/semantic-provider.js';

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe('CodeGraph semantic baseline', () => {
  it('records a deterministic ground-truth relation set without an LLM', async () => {
    root = join(tmpdir(), `memorix-codegraph-baseline-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'tests'), { recursive: true });
    writeFileSync(join(root, 'src', 'token.ts'), 'export function readToken() { return "ok"; }\n');
    writeFileSync(join(root, 'src', 'auth.ts'), [
      "import { readToken } from './token.js';",
      'export function auth() { return readToken(); }',
    ].join('\n'));
    writeFileSync(join(root, 'tests', 'auth.test.ts'), [
      "import { auth } from '../src/auth.js';",
      "test('auth', () => auth());",
    ].join('\n'));

    const lite = await indexProjectLite({ projectId: 'fixture/baseline', projectRoot: root });
    const result = buildTypeScriptSemanticIndex({ projectId: 'fixture/baseline', projectRoot: root, files: lite.files });
    const symbolsById = new Map(result.symbols.map(symbol => [symbol.id, symbol.name]));
    const filesById = new Map(lite.files.map(file => [file.id, file.path]));
    const relationKeys = result.edges.map(edge => {
      const from = edge.fromSymbolId ? symbolsById.get(edge.fromSymbolId) : edge.fromFileId ? filesById.get(edge.fromFileId) : undefined;
      const to = edge.toSymbolId ? symbolsById.get(edge.toSymbolId) : edge.toFileId ? filesById.get(edge.toFileId) : undefined;
      return `${edge.type}:${from ?? 'unknown'}->${to ?? 'unknown'}`;
    });

    expect(result.parsedFiles).toBe(3);
    expect(result.parserErrors).toBe(0);
    expect(result.symbols.map(symbol => symbol.name)).toEqual(expect.arrayContaining(['readToken', 'auth']));
    expect(relationKeys).toEqual(expect.arrayContaining([
      'imports:src/auth.ts->src/token.ts',
      'calls:auth->readToken',
      'tests:tests/auth.test.ts->auth',
    ]));
    expect(result.edges.every(edge => edge.source === 'typescript-compiler' && edge.confidence > 0)).toBe(true);
  });
});
