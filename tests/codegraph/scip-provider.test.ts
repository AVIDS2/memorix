import { describe, expect, it } from 'vitest';
import { normalizeScipOutline } from '../../src/codegraph/scip-provider.js';

describe('SCIP CodeGraph boundary', () => {
  it('normalizes source-backed definitions and relationships without accepting paths outside the project', () => {
    const outline = normalizeScipOutline({
      documents: [
        {
          relativePath: 'src/auth.ts',
          language: 'TypeScript',
          symbols: [{
            symbol: 'scip-typescript npm memorix auth/AuthService.',
            displayName: 'AuthService',
            kind: 'class',
            relationships: [{
              symbol: 'scip-typescript npm memorix auth/BaseService.',
              isImplementation: true,
            }],
          }],
          occurrences: [{
            symbol: 'scip-typescript npm memorix auth/AuthService.',
            isDefinition: true,
            range: [4, 0, 4, 10],
          }],
        },
        {
          relativePath: 'src/base.ts',
          language: 'TypeScript',
          symbols: [{
            symbol: 'scip-typescript npm memorix auth/BaseService.',
            displayName: 'BaseService',
            kind: 'class',
          }],
        },
        {
          relativePath: '../outside.ts',
          symbols: [{ symbol: 'outside', displayName: 'outside', kind: 'function' }],
        },
      ],
    }, { projectRoot: 'E:/fixture/memorix' });

    expect(outline).toBeDefined();
    expect(outline?.provider).toBe('external');
    expect(outline?.entryPoints.map(node => node.name)).toContain('AuthService');
    expect(outline?.relatedFiles).toEqual(expect.arrayContaining(['src/auth.ts', 'src/base.ts']));
    expect(outline?.relatedFiles).not.toContain('../outside.ts');
    expect(outline?.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'implements', line: 5 }),
    ]));
  });

  it('returns no outline for an unrelated payload', () => {
    expect(normalizeScipOutline({ documents: [] }, { projectRoot: 'E:/fixture/memorix' })).toBeUndefined();
    expect(normalizeScipOutline({ result: {} }, { projectRoot: 'E:/fixture/memorix' })).toBeUndefined();
  });

  it('accepts protobuf-style snake_case SCIP fields', () => {
    const outline = normalizeScipOutline({
      documents: [{
        relative_path: 'src/main.ts',
        language: 'TypeScript',
        symbols: [{ symbol: 'scip main.', display_name: 'main', kind: 'function' }],
        occurrences: [{ symbol: 'scip main.', symbol_roles: 1, range: [0, 0, 0, 4] }],
      }],
    }, { projectRoot: 'E:/fixture/memorix' });
    expect(outline?.entryPoints[0]).toMatchObject({ name: 'main', path: 'src/main.ts', startLine: 1 });
  });
});
