import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { indexProjectLite } from '../../src/codegraph/lite-provider.js';

let root: string | null = null;

function makeRoot(): string {
  root = join(tmpdir(), `memorix-lite-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe('CodeGraph Lite provider', () => {
  it('indexes TS files, imports, exports, and top-level symbols', async () => {
    const dir = makeRoot();
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'auth.ts'), [
      "import { verifyJwt } from './jwt';",
      'export function authMiddleware(req: Request) {',
      '  return verifyJwt(req);',
      '}',
      'export class AuthService {}',
      'export type AuthResult = { ok: boolean };',
    ].join('\n'));
    writeFileSync(join(dir, 'src', 'jwt.ts'), 'export const verifyJwt = () => true;\n');
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'ignored.ts'), 'export function ignored() {}\n');

    const result = await indexProjectLite({ projectId: 'org/repo', projectRoot: dir, exclude: ['dist/**'] });

    expect(result.files.map((f) => f.path).sort()).toEqual(['src/auth.ts', 'src/jwt.ts']);
    expect(result.symbols.map((s) => s.name)).toEqual(expect.arrayContaining(['authMiddleware', 'AuthService', 'AuthResult', 'verifyJwt']));
    expect(result.edges.some((e) => e.type === 'imports' && e.evidence?.includes('./jwt'))).toBe(true);
  });

  it('indexes common non-TS languages with file-level nodes and top-level symbols', async () => {
    const dir = makeRoot();
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'worker.py'), [
      'import os',
      'class Worker:',
      '    pass',
      'def run_job(name):',
      '    return name',
    ].join('\n'));
    writeFileSync(join(dir, 'src', 'server.go'), [
      'package main',
      'import "net/http"',
      'type Server struct {}',
      'func HandleRequest() {}',
    ].join('\n'));
    writeFileSync(join(dir, 'src', 'engine.rs'), [
      'use std::sync::Arc;',
      'pub struct Engine;',
      'pub enum Mode { Fast }',
      'pub fn run_engine() {}',
    ].join('\n'));
    writeFileSync(join(dir, 'src', 'PaymentService.java'), [
      'import java.util.List;',
      'public class PaymentService {',
      '  public void charge() {}',
      '}',
    ].join('\n'));
    writeFileSync(join(dir, 'src', 'AccountService.cs'), [
      'using System;',
      'public class AccountService {',
      '  public void Login() {}',
      '}',
    ].join('\n'));
    writeFileSync(join(dir, 'src', 'native.cpp'), [
      '#include <string>',
      'class NativeWorker {};',
      'void runNative() {}',
    ].join('\n'));
    writeFileSync(join(dir, 'README.md'), '# not indexed as code\n');

    const result = await indexProjectLite({ projectId: 'org/repo', projectRoot: dir });

    expect(result.files.map(file => file.path).sort()).toEqual([
      'src/AccountService.cs',
      'src/PaymentService.java',
      'src/engine.rs',
      'src/native.cpp',
      'src/server.go',
      'src/worker.py',
    ]);
    expect(result.files.map(file => file.language)).toEqual(expect.arrayContaining([
      'python',
      'go',
      'rust',
      'java',
      'csharp',
      'cpp',
    ]));
    expect(result.symbols.map(symbol => `${symbol.kind}:${symbol.name}`)).toEqual(expect.arrayContaining([
      'class:Worker',
      'function:run_job',
      'type:Server',
      'function:HandleRequest',
      'class:Engine',
      'type:Mode',
      'function:run_engine',
      'class:PaymentService',
      'method:charge',
      'class:AccountService',
      'method:Login',
      'class:NativeWorker',
      'function:runNative',
    ]));
    expect(result.edges.map(edge => edge.evidence)).toEqual(expect.arrayContaining([
      'os',
      'net/http',
      'std::sync::Arc',
      'java.util.List',
      'System',
      'string',
    ]));
  });

  it('skips common generated output directories by default', async () => {
    const dir = makeRoot();
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'main.ts'), 'export function main() {}\n');

    for (const generatedDir of ['dist', 'build', 'coverage', '.next', '.turbo', 'node_modules']) {
      mkdirSync(join(dir, generatedDir), { recursive: true });
      writeFileSync(join(dir, generatedDir, 'generated.ts'), 'export function generated() {}\n');
    }

    const result = await indexProjectLite({ projectId: 'org/repo', projectRoot: dir });

    expect(result.files.map(file => file.path)).toEqual(['src/main.ts']);
    expect(result.symbols.map(symbol => symbol.name)).toEqual(['main']);
  });

  it('continues indexing when a discovered file cannot be read', async () => {
    vi.resetModules();
    vi.doMock('node:fs', () => ({
      readdirSync: vi.fn((dir: string) => {
        if (dir.endsWith('repo')) {
          return [{ name: 'src', isDirectory: () => true, isFile: () => false }];
        }
        return [
          { name: 'stable.ts', isDirectory: () => false, isFile: () => true },
          { name: 'vanishing.ts', isDirectory: () => false, isFile: () => true },
        ];
      }),
      readFileSync: vi.fn((file: string) => {
        if (file.endsWith('vanishing.ts')) {
          throw Object.assign(new Error('file disappeared'), { code: 'ENOENT' });
        }
        return 'export function stable() {}\n';
      }),
      statSync: vi.fn(() => ({ mtimeMs: 42, size: 28 })),
    }));

    const { indexProjectLite: mockedIndexProjectLite } = await import('../../src/codegraph/lite-provider.js');
    const result = await mockedIndexProjectLite({ projectId: 'org/repo', projectRoot: join(tmpdir(), 'repo') });

    expect(result.files.map(file => file.path)).toEqual(['src/stable.ts']);
    expect(result.symbols.map(symbol => symbol.name)).toEqual(['stable']);
    vi.doUnmock('node:fs');
    vi.resetModules();
  });
});
