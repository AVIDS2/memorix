/**
 * Verify FIX-2: Git worktree compatibility for hook path resolution.
 *
 * Tests that resolveGitDir and resolveHooksDir handle:
 * 1. Normal repo (.git is a directory)
 * 2. Worktree (.git is a file with "gitdir: /path/to/actual/git/dir")
 * 3. Missing .git
 */

import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveGitDir, resolveHooksDir, ensureHooksDir } from '../../src/git/hooks-path.js';

describe('resolveGitDir', () => {
  const base = join(tmpdir(), 'memorix-git-test-' + Date.now());

  afterEach(() => {
    try { rmSync(base, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('should return .git path when .git is a directory', () => {
    const projDir = join(base, 'normal-repo');
    const gitDir = join(projDir, '.git');
    mkdirSync(gitDir, { recursive: true });

    const result = resolveGitDir(projDir);
    expect(result).toBe(gitDir);
  });

  it('should follow gitdir pointer when .git is a file (worktree)', () => {
    const projDir = join(base, 'worktree');
    mkdirSync(projDir, { recursive: true });

    // Create the actual git dir elsewhere
    const actualGitDir = join(base, 'actual-git-dir');
    mkdirSync(actualGitDir, { recursive: true });

    // Write .git file pointing to actual dir
    writeFileSync(join(projDir, '.git'), `gitdir: ${actualGitDir}\n`, 'utf-8');

    const result = resolveGitDir(projDir);
    expect(result).toBe(actualGitDir);
  });

  it('should handle relative gitdir paths in worktree .git file', () => {
    const projDir = join(base, 'worktree-rel');
    mkdirSync(projDir, { recursive: true });

    // Create the actual git dir as a sibling
    const actualGitDir = join(base, 'shared-git');
    mkdirSync(actualGitDir, { recursive: true });

    // Write .git file with relative path
    const relPath = '../shared-git';
    writeFileSync(join(projDir, '.git'), `gitdir: ${relPath}\n`, 'utf-8');

    const result = resolveGitDir(projDir);
    // Should resolve to absolute path
    expect(result).toBeTruthy();
    expect(existsSync(result!)).toBe(true);
  });

  it('should return null when no .git exists', () => {
    const projDir = join(base, 'no-git');
    mkdirSync(projDir, { recursive: true });

    const result = resolveGitDir(projDir);
    expect(result).toBeNull();
  });
});

describe('resolveHooksDir', () => {
  const base = join(tmpdir(), 'memorix-hooks-test-' + Date.now());

  afterEach(() => {
    try { rmSync(base, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('should return paths WITHOUT creating hooks dir (read-only)', () => {
    const projDir = join(base, 'normal');
    mkdirSync(join(projDir, '.git'), { recursive: true });

    const result = resolveHooksDir(projDir);
    expect(result).toBeTruthy();
    expect(result!.hooksDir).toContain('hooks');
    expect(result!.hookPath).toContain('post-commit');
    // P2 fix: resolveHooksDir must NOT create directories
    expect(existsSync(result!.hooksDir)).toBe(false);
  });

  it('should resolve hooks path through worktree .git file (read-only)', () => {
    const projDir = join(base, 'wt-proj');
    mkdirSync(projDir, { recursive: true });

    const actualGitDir = join(base, 'wt-git');
    mkdirSync(actualGitDir, { recursive: true });

    writeFileSync(join(projDir, '.git'), `gitdir: ${actualGitDir}\n`, 'utf-8');

    const result = resolveHooksDir(projDir);
    expect(result).toBeTruthy();
    expect(result!.hooksDir).toBe(join(actualGitDir, 'hooks'));
    expect(result!.hookPath).toBe(join(actualGitDir, 'hooks', 'post-commit'));
    // P2 fix: should NOT create hooks/ dir
    expect(existsSync(result!.hooksDir)).toBe(false);
  });

  it('should return null when no .git exists', () => {
    const projDir = join(base, 'empty');
    mkdirSync(projDir, { recursive: true });

    const result = resolveHooksDir(projDir);
    expect(result).toBeNull();
  });
});

describe('ensureHooksDir', () => {
  const base = join(tmpdir(), 'memorix-ensure-hooks-test-' + Date.now());

  afterEach(() => {
    try { rmSync(base, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('should create hooks dir on disk (write path)', () => {
    const projDir = join(base, 'normal');
    mkdirSync(join(projDir, '.git'), { recursive: true });

    const result = ensureHooksDir(projDir);
    expect(result).toBeTruthy();
    expect(existsSync(result!.hooksDir)).toBe(true);
  });

  it('should create hooks dir through worktree .git file', () => {
    const projDir = join(base, 'wt');
    mkdirSync(projDir, { recursive: true });

    const actualGitDir = join(base, 'wt-git');
    mkdirSync(actualGitDir, { recursive: true });

    writeFileSync(join(projDir, '.git'), `gitdir: ${actualGitDir}\n`, 'utf-8');

    const result = ensureHooksDir(projDir);
    expect(result).toBeTruthy();
    expect(existsSync(result!.hooksDir)).toBe(true);
    expect(result!.hooksDir).toBe(join(actualGitDir, 'hooks'));
  });

  it('should return null when no .git exists', () => {
    const projDir = join(base, 'empty');
    mkdirSync(projDir, { recursive: true });

    const result = ensureHooksDir(projDir);
    expect(result).toBeNull();
  });
});
