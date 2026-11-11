/**
 * Project Detector Diagnostics Tests
 *
 * Tests for detectProjectWithDiagnostics — ensures actionable error messages
 * for all failure modes: path not found, not a directory, no git, worktree, subdir.
 * Also tests real-repo detection with subdirectory traversal.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { detectProject, detectProjectWithDiagnostics, findGitInSubdirs } from '../../src/project/detector.js';

const tempDirs: string[] = [];

function makeTempDir(prefix = 'memorix-det-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
  }
  tempDirs.length = 0;
});

describe('detectProjectWithDiagnostics', () => {
  it('returns path_not_found for non-existent path', () => {
    const result = detectProjectWithDiagnostics('/this/path/does/not/exist/at/all');
    expect(result.project).toBeNull();
    expect(result.failure).not.toBeNull();
    expect(result.failure!.reason).toBe('path_not_found');
    expect(result.failure!.detail).toContain('does not exist');
  });

  it('returns not_a_directory for a file path', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'somefile.txt');
    writeFileSync(filePath, 'hello');
    const result = detectProjectWithDiagnostics(filePath);
    expect(result.project).toBeNull();
    expect(result.failure).not.toBeNull();
    expect(result.failure!.reason).toBe('not_a_directory');
    expect(result.failure!.detail).toContain('not a directory');
  });

  it('returns no_git or git_safe_directory for a directory without .git', () => {
    const dir = makeTempDir();
    const result = detectProjectWithDiagnostics(dir);
    expect(result.project).toBeNull();
    expect(result.failure).not.toBeNull();
    // On Windows, git CLI may report safe.directory instead of "not a git repo"
    expect(['no_git', 'git_safe_directory']).toContain(result.failure!.reason);
  });

  it('detects a real git repo (this repo)', () => {
    const result = detectProjectWithDiagnostics(process.cwd());
    expect(result.project).not.toBeNull();
    expect(result.failure).toBeNull();
    expect(result.project!.id).toBeTruthy();
    expect(result.project!.rootPath).toBeTruthy();
  });

  it('detects git repo from a subdirectory', () => {
    // process.cwd() is the memorix repo root; tests run from a subdir
    const subDir = join(process.cwd(), 'src');
    if (!existsSync(subDir)) return; // skip if src doesn't exist
    const result = detectProjectWithDiagnostics(subDir);
    expect(result.project).not.toBeNull();
    expect(result.failure).toBeNull();
    // rootPath should be the repo root, not the subdir
    expect(result.project!.rootPath.replace(/\\/g, '/')).toBe(
      process.cwd().replace(/\\/g, '/'),
    );
  });

  it('detects a freshly created local git repo (no remote)', () => {
    const dir = makeTempDir();
    try {
      execSync('git init', { cwd: dir, stdio: 'pipe' });
    } catch {
      return; // git not available, skip
    }
    const result = detectProjectWithDiagnostics(dir);
    expect(result.project).not.toBeNull();
    expect(result.failure).toBeNull();
    expect(result.project!.id).toMatch(/^local\//);
    expect(result.project!.gitRemote).toBeUndefined();
  });

  it('detects a git repo with a configured remote', () => {
    const dir = makeTempDir();
    try {
      execSync('git init', { cwd: dir, stdio: 'pipe' });
      execSync('git remote add origin https://github.com/test-user/test-repo.git', {
        cwd: dir, stdio: 'pipe',
      });
    } catch {
      return; // git not available, skip
    }
    const result = detectProjectWithDiagnostics(dir);
    expect(result.project).not.toBeNull();
    expect(result.failure).toBeNull();
    expect(result.project!.id).toBe('test-user/test-repo');
    expect(result.project!.gitRemote).toContain('test-user/test-repo');
  });
});

describe('findGitInSubdirs', () => {
  it('returns null for empty directory', () => {
    const dir = makeTempDir();
    expect(findGitInSubdirs(dir)).toBeNull();
  });

  it('finds a git repo in a subdirectory', () => {
    const root = makeTempDir();
    const sub = join(root, 'myproject');
    mkdirSync(sub);
    mkdirSync(join(sub, '.git'));
    const found = findGitInSubdirs(root);
    expect(found).not.toBeNull();
    expect(found!.replace(/\\/g, '/')).toContain('myproject');
  });

  it('skips hidden directories', () => {
    const root = makeTempDir();
    const hidden = join(root, '.hidden');
    mkdirSync(hidden);
    mkdirSync(join(hidden, '.git'));
    expect(findGitInSubdirs(root)).toBeNull();
  });
});

describe('detectProject backward compatibility', () => {
  it('returns ProjectInfo | null (no failure field)', () => {
    const project = detectProject(process.cwd());
    expect(project).not.toBeNull();
    expect(project!.id).toBeTruthy();

    const nullResult = detectProject('/nonexistent/path/xyz');
    expect(nullResult).toBeNull();
  });
});
