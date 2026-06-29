import { describe, expect, it } from 'vitest';
import { assembleContextPack, buildContextPackPrompt } from '../../src/codegraph/context-pack.js';

describe('buildContextPackPrompt', () => {
  it('renders memories, code facts, freshness warnings, reads, and verification', () => {
    const text = buildContextPackPrompt({
      task: 'continue auth bug',
      memories: [{
        id: 1,
        title: 'Use jose for auth',
        type: 'decision',
        status: 'current',
        reason: 'matched authMiddleware',
      }],
      codeFacts: [{
        path: 'src/auth.ts',
        symbol: 'authMiddleware',
        kind: 'function',
        line: 3,
      }],
      warnings: [{
        id: 2,
        title: 'Old auth file',
        status: 'stale',
        reason: 'referenced file no longer exists',
      }],
      suggestedReads: ['src/auth.ts', 'tests/auth.test.ts'],
      suggestedVerification: ['npm test -- auth'],
    });

    expect(text).toContain('## Task');
    expect(text).toContain('#1 current: [decision] Use jose for auth');
    expect(text).toContain('authMiddleware');
    expect(text).toContain('#2 stale: Old auth file');
    expect(text).toContain('src/auth.ts');
    expect(text).toContain('npm test -- auth');
  });

  it('assembles code facts and warnings from observation code refs', () => {
    const pack = assembleContextPack({
      task: 'continue auth bug',
      observations: [
        { id: 1, title: 'Use jose for auth', type: 'decision' },
        { id: 2, title: 'Old auth file', type: 'gotcha' },
      ],
      refs: [
        {
          id: 'coderef:current',
          projectId: 'org/repo',
          observationId: 1,
          fileId: 'file:auth',
          symbolId: 'symbol:auth',
          capturedFileHash: 'file-hash',
          capturedSymbolHash: 'symbol-hash',
          status: 'current',
          reason: 'bound by symbol mention',
          createdAt: '2026-06-29T00:00:00.000Z',
        },
        {
          id: 'coderef:stale',
          projectId: 'org/repo',
          observationId: 2,
          fileId: 'file:old',
          capturedFileHash: 'old-file-hash',
          status: 'current',
          reason: 'bound by file path',
          createdAt: '2026-06-29T00:00:00.000Z',
        },
      ],
      files: [
        {
          id: 'file:auth',
          projectId: 'org/repo',
          path: 'src/auth.ts',
          contentHash: 'file-hash',
          indexedAt: '2026-06-29T00:01:00.000Z',
        },
      ],
      symbols: [
        {
          id: 'symbol:auth',
          projectId: 'org/repo',
          fileId: 'file:auth',
          path: 'src/auth.ts',
          name: 'authMiddleware',
          qualifiedName: 'authMiddleware',
          kind: 'function',
          startLine: 3,
          contentHash: 'symbol-hash',
          indexedAt: '2026-06-29T00:01:00.000Z',
        },
      ],
    });

    expect(pack.memories).toEqual([
      expect.objectContaining({ id: 1, status: 'current' }),
    ]);
    expect(pack.codeFacts).toEqual([
      expect.objectContaining({ path: 'src/auth.ts', symbol: 'authMiddleware', line: 3 }),
    ]);
    expect(pack.warnings).toEqual([
      expect.objectContaining({ id: 2, status: 'stale' }),
    ]);
    expect(pack.suggestedReads).toEqual(['src/auth.ts']);
  });
});
