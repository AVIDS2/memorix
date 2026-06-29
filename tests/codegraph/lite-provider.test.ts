import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
});
