import { describe, expect, it } from 'vitest';
import { assembleContextPack, buildContextPackPrompt, selectRelevantObservations } from '../../src/codegraph/context-pack.js';

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
      }, {
        id: 3,
        title: 'Login bug was reproduced in staging',
        type: 'lesson',
        status: 'unbound',
        reason: 'task-relevant memory with no current code reference',
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
    expect(text).toContain('## Reliable Memories');
    expect(text).toContain('#1 current: [decision] Use jose for auth');
    expect(text).toContain('## Useful Unbound Memories');
    expect(text).toContain('#3 unbound: [lesson] Login bug was reproduced in staging');
    expect(text).toContain('authMiddleware');
    expect(text).toContain('#2 stale: Old auth file');
    expect(text).toContain('src/auth.ts');
    expect(text).toContain('npm test -- auth');
  });

  it('includes task-relevant unbound memories without treating stale refs as reliable', () => {
    const pack = assembleContextPack({
      task: 'continue auth bug',
      observations: [
        { id: 1, title: 'Use jose for auth', type: 'decision' },
        {
          id: 2,
          title: 'Auth rollout failed on Windows shell quoting',
          type: 'gotcha',
          narrative: 'When continuing the auth bug, remember that Windows command quoting broke the smoke test.',
          concepts: ['auth', 'windows'],
        },
        { id: 3, title: 'Old auth file', type: 'gotcha' },
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
          observationId: 3,
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
      expect.objectContaining({ id: 2, status: 'unbound' }),
    ]);
    expect(pack.warnings).toEqual([
      expect.objectContaining({ id: 3, status: 'stale' }),
    ]);
    expect(pack.suggestedVerification).toContain('Inspect the suggested files before trusting stale or unbound memories.');
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
          id: 'coderef:file-current',
          projectId: 'org/repo',
          observationId: 1,
          fileId: 'file:auth',
          capturedFileHash: 'file-hash',
          status: 'current',
          reason: 'bound by file path',
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
    expect(pack.memories).toHaveLength(1);
    expect(pack.codeFacts).toEqual([
      expect.objectContaining({ path: 'src/auth.ts', symbol: 'authMiddleware', line: 3 }),
      expect.objectContaining({ path: 'src/auth.ts' }),
    ]);
    expect(pack.warnings).toEqual([
      expect.objectContaining({ id: 2, status: 'stale' }),
    ]);
    expect(pack.suggestedReads).toEqual(['src/auth.ts']);
  });

  it('selects task-relevant observations before falling back to recency', () => {
    const selected = selectRelevantObservations([
      {
        id: 1,
        title: 'Recent unrelated dashboard memory',
        type: 'decision',
        narrative: 'Keep the dashboard route small.',
        filesModified: ['src/dashboard.ts'],
        createdAt: '2026-06-29T00:03:00.000Z',
      },
      {
        id: 2,
        title: 'Older authMiddleware memory',
        type: 'decision',
        narrative: 'authMiddleware owns JWT validation.',
        filesModified: ['src/auth.ts'],
        createdAt: '2026-06-29T00:01:00.000Z',
      },
    ], 'continue authMiddleware bug', 1);

    expect(selected.map(obs => obs.id)).toEqual([2]);
  });

  it('caps prompt code facts and suggested reads while filtering generated outputs', () => {
    const text = buildContextPackPrompt({
      task: 'continue auth work',
      memories: [],
      codeFacts: [
        { path: 'src/auth.ts', symbol: 'authMiddleware', kind: 'function', line: 3 },
        { path: 'dist/auth.js', symbol: 'authMiddleware', kind: 'function', line: 3 },
        { path: 'packages/agent-core/dist/index.js', symbol: 'status', kind: 'function', line: 1 },
        { path: 'packages\\agent-core\\dist\\index.js', symbol: 'statusWin', kind: 'function', line: 2 },
        { path: '.tmp/release-smoke/cache.ts', symbol: 'cachedSmoke', kind: 'function', line: 1 },
        { path: '.worktrees/release/src/release.ts', symbol: 'releaseSmoke', kind: 'function', line: 1 },
        { path: '.claude/worktrees/release/src/release.ts', symbol: 'claudeReleaseSmoke', kind: 'function', line: 1 },
        { path: 'src/config.ts', symbol: 'configureAuth', kind: 'function', line: 8 },
        { path: 'src/router.ts', symbol: 'routeAuth', kind: 'function', line: 12 },
        { path: 'src/session.ts', symbol: 'sessionAuth', kind: 'function', line: 20 },
        { path: 'src/extra.ts', symbol: 'extraAuth', kind: 'function', line: 40 },
        { path: 'src/overflow.ts', symbol: 'overflowAuth', kind: 'function', line: 50 },
      ],
      warnings: [],
      suggestedReads: [
        'src/auth.ts',
        'dist/auth.js',
        'packages/agent-core/dist/index.js',
        'packages\\agent-core\\dist\\index.js',
        '.tmp/release-smoke/cache.ts',
        '.worktrees/release/src/release.ts',
        '.claude/worktrees/release/src/release.ts',
        'src/config.ts',
        'src/router.ts',
        'src/session.ts',
        'src/extra.ts',
        'src/overflow.ts',
      ],
      suggestedVerification: [],
    });

    expect(text).toContain('src/auth.ts');
    expect(text).toContain('src/config.ts');
    expect(text).not.toContain('dist/auth.js');
    expect(text).not.toContain('packages/agent-core/dist/index.js');
    expect(text).not.toContain('packages\\agent-core\\dist\\index.js');
    expect(text).not.toContain('.tmp/release-smoke/cache.ts');
    expect(text).not.toContain('.worktrees/release/src/release.ts');
    expect(text).not.toContain('.claude/worktrees/release/src/release.ts');
    expect(text).toContain('src/extra.ts');
    expect(text).not.toContain('src/overflow.ts');
  });
});
