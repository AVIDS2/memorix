import { describe, expect, it } from 'vitest';
import type { CodeFile, CodeSymbol, ObservationCodeRef } from '../../src/codegraph/types.js';
import { evaluateCodeRefFreshness } from '../../src/codegraph/freshness.js';

const indexedAt = '2026-06-29T00:00:00.000Z';
const createdAt = '2026-06-29T00:01:00.000Z';

function file(overrides: Partial<CodeFile> = {}): CodeFile {
  return {
    id: 'file:a',
    projectId: 'org/repo',
    path: 'src/auth.ts',
    contentHash: 'file-hash',
    indexedAt,
    ...overrides,
  };
}

function symbol(overrides: Partial<CodeSymbol> = {}): CodeSymbol {
  return {
    id: 'symbol:a',
    projectId: 'org/repo',
    fileId: 'file:a',
    path: 'src/auth.ts',
    name: 'authMiddleware',
    qualifiedName: 'authMiddleware',
    kind: 'function',
    contentHash: 'symbol-hash',
    indexedAt,
    ...overrides,
  };
}

function ref(overrides: Partial<ObservationCodeRef> = {}): ObservationCodeRef {
  return {
    id: 'coderef:a',
    projectId: 'org/repo',
    observationId: 1,
    fileId: 'file:a',
    symbolId: 'symbol:a',
    capturedFileHash: 'file-hash',
    capturedSymbolHash: 'symbol-hash',
    status: 'current',
    createdAt,
    ...overrides,
  };
}

describe('evaluateCodeRefFreshness', () => {
  it('keeps a reference current when captured hashes still match', () => {
    expect(evaluateCodeRefFreshness(ref(), file(), symbol())).toMatchObject({
      status: 'current',
    });
  });

  it('marks a reference suspect when the file changed but the symbol cannot prove stability', () => {
    expect(evaluateCodeRefFreshness(ref({ capturedSymbolHash: undefined }), file({ contentHash: 'new-file-hash' }), symbol())).toMatchObject({
      status: 'suspect',
    });
  });

  it('keeps a symbol-level reference current when the file changed but the captured symbol hash still matches', () => {
    expect(evaluateCodeRefFreshness(ref(), file({ contentHash: 'new-file-hash' }), symbol())).toMatchObject({
      status: 'current',
    });
  });

  it('marks a reference stale when its captured symbol is gone or changed', () => {
    expect(evaluateCodeRefFreshness(ref(), file(), undefined)).toMatchObject({
      status: 'stale',
    });
    expect(evaluateCodeRefFreshness(ref(), file(), symbol({ contentHash: 'new-symbol-hash' }))).toMatchObject({
      status: 'stale',
    });
  });
});
