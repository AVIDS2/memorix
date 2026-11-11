import { describe, expect, it } from 'vitest';
import { makeCodeEdgeId, makeCodeFileId, makeCodeSymbolId } from '../../src/codegraph/ids.js';

describe('codegraph ids', () => {
  it('creates stable project-scoped file ids with normalized separators', () => {
    expect(makeCodeFileId('org/repo', 'src\\auth\\index.ts')).toBe(makeCodeFileId('org/repo', 'src/auth/index.ts'));
    expect(makeCodeFileId('org/repo', 'src/auth/index.ts')).not.toBe(makeCodeFileId('other/repo', 'src/auth/index.ts'));
    expect(makeCodeFileId('org/repo', 'src/auth/index.ts')).toMatch(/^file:[a-f0-9]{16}$/);
  });

  it('creates stable symbol ids from file path, qualified name, and kind', () => {
    const a = makeCodeSymbolId({
      projectId: 'org/repo',
      path: 'src/auth.ts',
      qualifiedName: 'authMiddleware',
      kind: 'function',
    });
    const b = makeCodeSymbolId({
      projectId: 'org/repo',
      path: 'src/auth.ts',
      qualifiedName: 'authMiddleware',
      kind: 'function',
    });
    const c = makeCodeSymbolId({
      projectId: 'org/repo',
      path: 'src/auth.ts',
      qualifiedName: 'AuthMiddleware',
      kind: 'type',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^symbol:[a-f0-9]{16}$/);
  });

  it('creates stable edge ids from endpoints and type', () => {
    expect(makeCodeEdgeId('org/repo', 'a', 'calls', 'b')).toBe(makeCodeEdgeId('org/repo', 'a', 'calls', 'b'));
    expect(makeCodeEdgeId('org/repo', 'a', 'calls', 'b')).not.toBe(makeCodeEdgeId('org/repo', 'b', 'calls', 'a'));
    expect(makeCodeEdgeId('org/repo', 'a', 'calls', 'b')).toMatch(/^edge:[a-f0-9]{16}$/);
  });
});
