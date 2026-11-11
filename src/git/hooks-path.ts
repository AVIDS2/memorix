/**
 * Git hooks path resolver — worktree-safe.
 *
 * In a normal repo:   .git is a directory  → hooks at .git/hooks/
 * In a git worktree:  .git is a FILE containing "gitdir: /path/to/actual/git/dir"
 *                     → hooks at that resolved path + /hooks/
 *
 * This utility ensures all hook install/uninstall/check operations
 * work correctly in both scenarios.
 */

import { existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Resolve the actual .git directory path, following worktree indirection.
 *
 * @param projectRoot - The root of the working tree (where .git lives)
 * @returns Absolute path to the real git dir, or null if no .git found
 */
export function resolveGitDir(projectRoot: string): string | null {
  const dotGit = path.join(projectRoot, '.git');

  if (!existsSync(dotGit)) return null;

  const stat = statSync(dotGit);

  if (stat.isDirectory()) {
    // Normal repo — .git is a directory
    return dotGit;
  }

  if (stat.isFile()) {
    // Worktree — .git is a file: "gitdir: /path/to/actual/git/dir"
    try {
      const content = readFileSync(dotGit, 'utf-8').trim();
      const match = content.match(/^gitdir:\s*(.+)$/);
      if (match) {
        const gitdir = match[1].trim();
        // Resolve relative paths against the project root
        const resolved = path.isAbsolute(gitdir)
          ? gitdir
          : path.resolve(projectRoot, gitdir);
        if (existsSync(resolved)) {
          return resolved;
        }
      }
    } catch {
      // Unreadable .git file — fall through
    }
  }

  return null;
}

/**
 * Resolve the hooks directory for a project (read-only — does NOT create directories).
 * Handles both normal repos and git worktrees.
 *
 * @param projectRoot - The root of the working tree
 * @returns Object with hooksDir and hookPath for post-commit, or null if no .git found
 */
export function resolveHooksDir(projectRoot: string): { hooksDir: string; hookPath: string } | null {
  const gitDir = resolveGitDir(projectRoot);
  if (!gitDir) return null;

  const hooksDir = path.join(gitDir, 'hooks');

  return {
    hooksDir,
    hookPath: path.join(hooksDir, 'post-commit'),
  };
}

/**
 * Resolve hooks directory AND ensure it exists on disk.
 * Use this only in write paths (hook install / autoHook).
 */
export function ensureHooksDir(projectRoot: string): { hooksDir: string; hookPath: string } | null {
  const resolved = resolveHooksDir(projectRoot);
  if (!resolved) return null;

  mkdirSync(resolved.hooksDir, { recursive: true });
  return resolved;
}
