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

function makeFixture(): string {
  root = join(tmpdir(), `memorix-semantic-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(join(root, 'src', 'base.ts'), [
    'export interface TokenSource { read(): string; }',
    'export class BaseAuth {',
    '  readToken(source: TokenSource) { return source.read(); }',
    '}',
  ].join('\n'));
  writeFileSync(join(root, 'src', 'auth.ts'), [
    "import { BaseAuth } from './base.js';",
    'export class AuthService extends BaseAuth {',
    '  verify(source: TokenSource) { return this.readToken(source); }',
    '}',
    'export const makeAuth = () => new AuthService();',
  ].join('\n'));
  writeFileSync(join(root, 'tests', 'auth.test.ts'), [
    "import { makeAuth } from '../src/auth.js';",
    "test('auth', () => { makeAuth(); });",
  ].join('\n'));
  return root;
}

describe('TypeScript semantic CodeGraph provider', () => {
  it('extracts nested symbols with real locations and resolves local imports', async () => {
    const projectRoot = makeFixture();
    const lite = await indexProjectLite({ projectId: 'fixture/semantic', projectRoot });
    const result = buildTypeScriptSemanticIndex({
      projectId: 'fixture/semantic',
      projectRoot,
      files: lite.files,
    });

    expect(result.parsedFiles).toBe(3);
    expect(result.parserErrors).toBe(0);
    expect(result.symbols.map(symbol => `${symbol.kind}:${symbol.qualifiedName}`)).toEqual(expect.arrayContaining([
      'interface:TokenSource',
      'class:BaseAuth',
      'method:BaseAuth::readToken',
      'class:AuthService',
      'method:AuthService::verify',
      'function:makeAuth',
    ]));
    expect(result.symbols.every(symbol => symbol.source === 'typescript-compiler')).toBe(true);
    expect(result.symbols.find(symbol => symbol.qualifiedName === 'AuthService::verify')).toMatchObject({
      startLine: 3,
      endLine: 3,
    });
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'imports', evidence: expect.stringContaining('./base.js'), source: 'typescript-compiler' }),
      expect.objectContaining({ type: 'calls', evidence: expect.stringContaining('resolved call') }),
      expect.objectContaining({ type: 'extends', source: 'typescript-compiler' }),
      expect.objectContaining({ type: 'tests', source: 'typescript-compiler' }),
    ]));
  });

  it('does not fabricate an edge for an unresolved dynamic call', async () => {
    const projectRoot = makeFixture();
    writeFileSync(join(projectRoot, 'src', 'dynamic.ts'), [
      'const name = Math.random() > 0.5 ? "missingA" : "missingB";',
      'export function invoke() { return (globalThis as any)[name](); }',
    ].join('\n'));
    const lite = await indexProjectLite({ projectId: 'fixture/dynamic', projectRoot });
    const result = buildTypeScriptSemanticIndex({
      projectId: 'fixture/dynamic',
      projectRoot,
      files: lite.files,
    });

    expect(result.symbols.map(symbol => symbol.name)).toContain('invoke');
    expect(result.edges.filter(edge => edge.type === 'calls' && edge.evidence?.includes('dynamic'))).toHaveLength(0);
    expect(result.unresolvedCalls).toBeGreaterThan(0);
  });
});
