import { afterEach, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyGitIngestPolicy } from '../../src/cli/commands/ingest-commit.js';
import { getCommitInfo, type CommitInfo } from '../../src/git/extractor.js';

/**
 * Git ingest policy exam: the documented ingest_on_commit / max_diff_size
 * settings must actually gate behavior — a config that does nothing is a lie
 * to the operator. Deterministic, offline.
 */

function fakeCommit(diffSummary: string): CommitInfo {
  return {
    hash: 'a'.repeat(40),
    shortHash: 'abcdef7',
    author: 'tester',
    date: '2026-08-14T00:00:00Z',
    subject: 'test commit',
    body: '',
    filesChanged: ['src/x.ts'],
    insertions: 1,
    deletions: 0,
    diffSummary,
  };
}

describe('git ingest policy exam', () => {
  let dir = '';

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('skips auto ingest when ingest_on_commit is false', () => {
    const result = applyGitIngestPolicy(fakeCommit('diff'), { ingestOnCommit: false });
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('ingest_on_commit');
  });

  it('does not skip when ingest_on_commit is true or unset', () => {
    expect(applyGitIngestPolicy(fakeCommit('diff'), { ingestOnCommit: true }).skip).toBe(false);
    expect(applyGitIngestPolicy(fakeCommit('diff'), {}).skip).toBe(false);
  });

  it('caps the diff content at max_diff_size', () => {
    const long = 'x'.repeat(400);
    const capped = applyGitIngestPolicy(fakeCommit(long), { maxDiffSize: 100 });
    expect(capped.skip).toBe(false);
    expect(capped.diffSummary.length).toBe(100);
    const untouched = applyGitIngestPolicy(fakeCommit(long), {});
    expect(untouched.diffSummary.length).toBe(400);
  });

  it('getCommitInfo honors an explicit diff cap and defaults to 500', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'memorix-ingest-policy-'));
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email test@example.com', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.name "Memorix Test"', { cwd: dir, stdio: 'ignore' });
    writeFileSync(path.join(dir, 'big.txt'), 'line ' + 'word '.repeat(500) + '\n', 'utf8');
    execSync('git add big.txt && git commit -m "test: big diff"', { cwd: dir, stdio: 'ignore' });

    const small = getCommitInfo(dir, 'HEAD', 40);
    expect(small.diffSummary.length).toBeLessThanOrEqual(40);
    const normal = getCommitInfo(dir, 'HEAD');
    expect(normal.diffSummary.length).toBeLessThanOrEqual(500);
  }, 30_000);
});
