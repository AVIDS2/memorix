/**
 * Git Extractor + Project Detection Integration Tests
 *
 * Tests the full git→memory pipeline:
 * - Project ID detection from .git
 * - Commit parsing and type inference
 * - Concept extraction
 * - Ingest commit → memory-ready result
 */

import { describe, it, expect } from 'vitest';
import { detectProject } from '../../src/project/detector.js';
import { getCommitInfo, getRecentCommits, ingestCommit } from '../../src/git/extractor.js';

describe('Git Project Detection', () => {
  it('should detect AVIDS2/memorix from git remote', () => {
    const project = detectProject();
    expect(project).not.toBeNull();
    expect(project!.id).toBe('AVIDS2/memorix');
    expect(project!.gitRemote).toBeTruthy();
    expect(project!.rootPath).toBeTruthy();
  }, 30_000);

  it('should return null for /tmp (no .git)', () => {
    expect(detectProject('/tmp')).toBeNull();
  });

  it('should return null for empty temp dir', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'memorix-no-git-'));
    expect(detectProject(dir)).toBeNull();
  }, 30_000);

  it('should detect local git repo without remote', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { execSync } = await import('node:child_process');
    const dir = mkdtempSync(join(tmpdir(), 'memorix-local-git-'));
    execSync('git init', { cwd: dir, stdio: 'pipe' });
    const project = detectProject(dir);
    expect(project).not.toBeNull();
    expect(project!.id).toMatch(/^local\//);
    expect(project!.gitRemote).toBeUndefined();
  }, 30_000);
});

describe('Git Commit Parsing', () => {
  it('should parse HEAD commit', () => {
    const commit = getCommitInfo(process.cwd());
    expect(commit.hash).toMatch(/^[a-f0-9]{40}$/);
    expect(commit.shortHash).toMatch(/^[a-f0-9]{7,}$/);
    expect(commit.author).toBeTruthy();
    expect(commit.date).toBeTruthy();
    expect(commit.subject).toBeTruthy();
    expect(commit.filesChanged).toBeInstanceOf(Array);
    expect(commit.insertions).toBeGreaterThanOrEqual(0);
    expect(commit.deletions).toBeGreaterThanOrEqual(0);
  }, 30_000);

  it('should parse recent commits', () => {
    const commits = getRecentCommits(process.cwd(), 5);
    expect(commits.length).toBeGreaterThanOrEqual(1);
    expect(commits.length).toBeLessThanOrEqual(5);
    for (const c of commits) {
      expect(c.hash).toMatch(/^[a-f0-9]{40}$/);
      expect(c.subject).toBeTruthy();
    }
  }, 30_000);
});

describe('Git Ingest (commit → memory)', () => {
  it('should ingest HEAD commit into memory-ready result', () => {
    const commit = getCommitInfo(process.cwd());
    const result = ingestCommit(commit);

    expect(result.entityName).toBeTruthy();
    expect(result.type).toBeTruthy();
    expect(result.title).toBeTruthy();
    expect(result.narrative).toContain(commit.shortHash);
    expect(result.facts.length).toBeGreaterThanOrEqual(3);
    expect(result.filesModified).toEqual(commit.filesChanged);
  }, 30_000);

  it('should infer correct types from commit messages', () => {
    const mockCommit = (subject: string): Parameters<typeof ingestCommit>[0] => ({
      hash: 'a'.repeat(40), shortHash: 'aaaaaaa', author: 'test',
      date: '2026-01-01', subject, body: '', filesChanged: ['src/foo.ts'],
      insertions: 10, deletions: 5, diffSummary: '',
    });

    expect(ingestCommit(mockCommit('fix: resolve crash on startup')).type).toBe('problem-solution');
    expect(ingestCommit(mockCommit('feat: add dark mode')).type).toBe('what-changed');
    expect(ingestCommit(mockCommit('refactor: clean up auth module')).type).toBe('what-changed');
    expect(ingestCommit(mockCommit('docs: update README')).type).toBe('how-it-works');
    expect(ingestCommit(mockCommit('test: add e2e tests')).type).toBe('discovery');
    expect(ingestCommit(mockCommit('perf: optimize query cache')).type).toBe('trade-off');
    expect(ingestCommit(mockCommit('security: patch CVE-2025-1234')).type).toBe('gotcha');
    expect(ingestCommit(mockCommit('revert: rollback bad deploy')).type).toBe('problem-solution');
    expect(ingestCommit(mockCommit('chore: bump version to 2.0')).type).toBe('what-changed');
    expect(ingestCommit(mockCommit('deprecate: drop legacy API')).type).toBe('decision');
  });

  it('should extract concepts from conventional commit scopes', () => {
    const mockCommit = (subject: string): Parameters<typeof ingestCommit>[0] => ({
      hash: 'b'.repeat(40), shortHash: 'bbbbbbb', author: 'test',
      date: '2026-01-01', subject, body: '', filesChanged: ['src/foo.ts'],
      insertions: 10, deletions: 5, diffSummary: '',
    });

    const result1 = ingestCommit(mockCommit('feat(auth): add OAuth2'));
    expect(result1.entityName).toBe('auth');
    expect(result1.concepts).toContain('auth');

    const result2 = ingestCommit(mockCommit('fix: redis connection timeout'));
    expect(result2.concepts).toContain('redis');
  });

  it('should extract entity from first file directory when no scope', () => {
    const commit = {
      hash: 'c'.repeat(40), shortHash: 'ccccccc', author: 'test',
      date: '2026-01-01', subject: 'update something', body: '',
      filesChanged: ['src/hooks/handler.ts', 'src/hooks/types.ts'],
      insertions: 10, deletions: 5, diffSummary: '',
    };
    const result = ingestCommit(commit);
    expect(result.entityName).toBe('src');
  });

  it('should handle large file lists gracefully', () => {
    const commit = {
      hash: 'd'.repeat(40), shortHash: 'ddddddd', author: 'test',
      date: '2026-01-01', subject: 'big refactor', body: '',
      filesChanged: Array.from({ length: 20 }, (_, i) => `src/file${i}.ts`),
      insertions: 500, deletions: 300, diffSummary: '',
    };
    const result = ingestCommit(commit);
    // Should summarize rather than list all files
    expect(result.facts.some(f => f.includes('20 changed'))).toBe(true);
  });
});
