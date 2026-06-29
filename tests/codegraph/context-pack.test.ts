import { describe, expect, it } from 'vitest';
import { buildContextPackPrompt } from '../../src/codegraph/context-pack.js';

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
});
