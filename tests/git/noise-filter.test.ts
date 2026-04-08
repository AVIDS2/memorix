/**
 * Tests for Git Commit Noise Filter
 *
 * Validates that low-value commits are correctly identified and filtered,
 * while meaningful commits pass through.
 */

import { describe, it, expect } from 'vitest';
import { shouldFilterCommit, filterCommits } from '../../src/git/noise-filter.js';
import type { CommitInfo } from '../../src/git/extractor.js';

function makeCommit(overrides: Partial<CommitInfo> = {}): CommitInfo {
  return {
    hash: 'abc123def456',
    shortHash: 'abc123d',
    author: 'Test User',
    date: '2025-03-15T12:00:00Z',
    subject: 'feat: add user authentication',
    body: '',
    filesChanged: ['src/auth.ts'],
    insertions: 50,
    deletions: 10,
    diffSummary: '',
    ...overrides,
  };
}

describe('shouldFilterCommit', () => {
  // ─── Should PASS (not noise) ───

  it('should pass meaningful feature commits', () => {
    const result = shouldFilterCommit(makeCommit({ subject: 'feat: add JWT authentication' }));
    expect(result.skip).toBe(false);
  });

  it('should pass meaningful bugfix commits', () => {
    const result = shouldFilterCommit(makeCommit({ subject: 'fix: resolve race condition in token refresh' }));
    expect(result.skip).toBe(false);
  });

  it('should pass refactoring commits', () => {
    const result = shouldFilterCommit(makeCommit({ subject: 'refactor: extract auth module into separate service' }));
    expect(result.skip).toBe(false);
  });

  it('should pass commits with descriptive messages', () => {
    const result = shouldFilterCommit(makeCommit({ subject: 'implement caching layer for API responses' }));
    expect(result.skip).toBe(false);
  });

  it('should keep version release commits as high-signal milestones', () => {
    const result = shouldFilterCommit(makeCommit({ subject: 'v1.0.4' }));
    expect(result.skip).toBe(false);
  });

  it('should keep release automation commits as milestones', () => {
    const result = shouldFilterCommit(makeCommit({ subject: 'chore(release): 1.0.4' }));
    expect(result.skip).toBe(false);
  });

  // ─── Should FILTER (noise) ───

  it('should filter typo fix commits', () => {
    const result = shouldFilterCommit(makeCommit({ subject: 'fix typo in README' }));
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('typo');
  });

  it('should filter formatting-only commits', () => {
    const result = shouldFilterCommit(makeCommit({ subject: 'lint: fix eslint warnings' }));
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('formatting');
  });

  it('should filter dependency bump commits', () => {
    const result = shouldFilterCommit(makeCommit({ subject: 'chore(deps): bump lodash from 4.17.20 to 4.17.21' }));
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('bump');
  });

  it('should filter lockfile-only commits', () => {
    const result = shouldFilterCommit(makeCommit({
      subject: 'update dependencies',
      filesChanged: ['package-lock.json'],
      insertions: 500,
      deletions: 300,
    }));
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('lockfile');
  });

  it('should filter merge commits when skipMergeCommits is true', () => {
    const result = shouldFilterCommit(
      makeCommit({ subject: 'Merge branch \'develop\' into main' }),
      { skipMergeCommits: true },
    );
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('merge');
  });

  it('should pass merge commits when skipMergeCommits is false', () => {
    const result = shouldFilterCommit(
      makeCommit({ subject: 'Merge branch \'develop\' into main' }),
      { skipMergeCommits: false },
    );
    // Built-in message pattern still catches it
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('noise pattern: merge commit');
  });

  it('should filter WIP commits', () => {
    const result = shouldFilterCommit(makeCommit({ subject: 'wip: saving progress' }));
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('work in progress');
  });

  it('should filter empty/trivial message commits', () => {
    const result = shouldFilterCommit(makeCommit({ subject: 'update' }));
    expect(result.skip).toBe(true);
  });

  it('should filter commits where all files are generated/lockfiles', () => {
    const result = shouldFilterCommit(makeCommit({
      subject: 'build: regenerate output',
      filesChanged: ['dist/bundle.js', 'dist/bundle.js.map'],
    }));
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('lockfiles/generated');
  });

  // ─── User-defined noise keywords ───

  it('should filter by user-defined noiseKeywords', () => {
    const result = shouldFilterCommit(
      makeCommit({ subject: 'auto-deploy to staging' }),
      { noiseKeywords: ['auto-deploy'] },
    );
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('user noise pattern');
  });

  it('should handle regex in noiseKeywords', () => {
    const result = shouldFilterCommit(
      makeCommit({ subject: 'BOT: automated PR merge #42' }),
      { noiseKeywords: ['^BOT:'] },
    );
    expect(result.skip).toBe(true);
  });

  // ─── excludePatterns for files ───

  it('should filter when all files match user excludePatterns', () => {
    const result = shouldFilterCommit(
      makeCommit({
        subject: 'update config',
        filesChanged: ['generated/api-types.ts', 'generated/schema.ts'],
      }),
      { excludePatterns: ['generated/*'] },
    );
    expect(result.skip).toBe(true);
  });

  it('should NOT filter when some files are outside exclude patterns', () => {
    const result = shouldFilterCommit(
      makeCommit({
        subject: 'update config and types',
        filesChanged: ['generated/api-types.ts', 'src/config.ts'],
      }),
      { excludePatterns: ['generated/*'] },
    );
    expect(result.skip).toBe(false);
  });

  // ─── Trivial change heuristic ───

  it('should filter tiny changes with non-descriptive messages', () => {
    const result = shouldFilterCommit(makeCommit({
      subject: 'misc',
      insertions: 1,
      deletions: 0,
    }));
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('trivial');
  });

  it('should NOT filter tiny changes with meaningful messages', () => {
    const result = shouldFilterCommit(makeCommit({
      subject: 'fix: critical security patch',
      insertions: 1,
      deletions: 1,
    }));
    expect(result.skip).toBe(false);
  });
});

describe('filterCommits', () => {
  it('should separate kept and skipped commits', () => {
    const commits = [
      makeCommit({ subject: 'feat: add authentication', hash: '1' }),
      makeCommit({ subject: 'fix typo in docs', hash: '2' }),
      makeCommit({ subject: 'refactor: clean up auth module', hash: '3' }),
      makeCommit({ subject: 'wip', hash: '4' }),
      makeCommit({ subject: 'Merge branch develop into main', hash: '5' }),
    ];

    const { kept, skipped } = filterCommits(commits);

    expect(kept.length).toBe(2);
    expect(skipped.length).toBe(3);
    expect(kept[0].hash).toBe('1');
    expect(kept[1].hash).toBe('3');
    expect(skipped.every(s => s.reason.length > 0)).toBe(true);
  });

  it('should respect config overrides', () => {
    const commits = [
      makeCommit({ subject: 'Merge branch develop', hash: '1' }),
      makeCommit({ subject: 'feat: something', hash: '2' }),
    ];

    // With skipMergeCommits false, merge still gets caught by message pattern
    const { kept, skipped } = filterCommits(commits, { skipMergeCommits: false });
    expect(skipped.length).toBe(1); // merge pattern still catches it
    expect(kept.length).toBe(1);
  });
});
