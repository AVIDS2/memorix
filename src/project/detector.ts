/**
 * Project Detector
 *
 * Strict .git-based project detection.
 * No .git = not a project. No fallbacks, no accommodations.
 *
 * ID strategy:
 *   - .git + remote → normalizeGitRemote(remote)  (globally unique, e.g. "user/repo")
 *   - .git + no remote → "local/<dirname>"         (local git repo, no remote yet)
 *   - no .git → null                               (not a project)
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ProjectInfo } from '../types.js';

/**
 * Detect the current project identity from Git.
 * Returns null if no .git directory is found — caller must handle this.
 * @param cwd - Working directory to detect from (defaults to process.cwd())
 */
export function detectProject(cwd?: string): ProjectInfo | null {
  const basePath = cwd ?? process.cwd();
  const gitRoot = getGitRoot(basePath);

  if (!gitRoot) {
    return null;
  }

  const gitRemote = getGitRemote(gitRoot);

  if (gitRemote) {
    const id = normalizeGitRemote(gitRemote);
    const name = id.split('/').pop() ?? path.basename(gitRoot);
    return { id, name, gitRemote, rootPath: gitRoot };
  }

  // Git repo without remote — local-only project
  const name = path.basename(gitRoot);
  const id = `local/${name}`;
  return { id, name, rootPath: gitRoot };
}

/**
 * Get the Git repository root directory.
 * Returns null if not inside a git repository.
 */
function getGitRoot(cwd: string): string | null {
  // Fast path: walk up to find .git directory (instant, no subprocess)
  let dir = path.resolve(cwd);
  const fsRoot = path.parse(dir).root;
  while (dir !== fsRoot) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }

  // Slow path: git CLI for edge cases (submodules, worktrees, bare repos)
  try {
    const root = execSync('git -c safe.directory=* rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim();
    return root || null;
  } catch {
    return null;
  }
}

/**
 * Get the Git remote URL for the given directory.
 * Returns null if not a git repository or no remote configured.
 */
function getGitRemote(cwd: string): string | null {
  // Fast path: read .git/config directly (instant, no subprocess)
  const fsRemote = readGitConfigRemote(cwd);
  if (fsRemote) return fsRemote;

  // Slow path: git CLI for edge cases (submodules, worktrees, non-standard layouts)
  try {
    const remote = execSync('git -c safe.directory=* remote get-url origin', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim();
    return remote || null;
  } catch {
    return null;
  }
}

/**
 * Fallback: parse remote.origin.url from .git/config when git CLI fails.
 * Handles Windows "dubious ownership" and other permission issues.
 */
function readGitConfigRemote(cwd: string): string | null {
  try {
    const configPath = path.join(cwd, '.git', 'config');
    if (!existsSync(configPath)) return null;
    const content = readFileSync(configPath, 'utf-8');
    // Parse INI-style: [remote "origin"] section, url = ...
    const remoteMatch = content.match(/\[remote\s+"origin"\]([\s\S]*?)(?=\n\[|$)/);
    if (!remoteMatch) return null;
    const urlMatch = remoteMatch[1].match(/^\s*url\s*=\s*(.+)$/m);
    return urlMatch ? urlMatch[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Scan immediate subdirectories for a .git directory.
 * Used when the workspace root itself isn't a git repo (multi-project workspace).
 * Returns the first subdirectory containing .git, or null.
 */
export function findGitInSubdirs(dir: string): string | null {
  try {
    const resolved = path.resolve(dir);
    const entries = readdirSync(resolved);
    for (const entry of entries) {
      if (entry.startsWith('.')) continue; // skip hidden dirs
      const fullPath = path.join(resolved, entry);
      try {
        if (statSync(fullPath).isDirectory() && existsSync(path.join(fullPath, '.git'))) {
          return fullPath;
        }
      } catch { /* permission error, skip */ }
    }
  } catch { /* readdir failed */ }
  return null;
}

/**
 * Normalize a Git remote URL to a consistent project ID.
 *
 * Examples:
 *   https://github.com/user/repo.git  → user/repo
 *   git@github.com:user/repo.git      → user/repo
 *   ssh://git@github.com/user/repo    → user/repo
 */
function normalizeGitRemote(remote: string): string {
  let normalized = remote;

  // Remove trailing .git
  normalized = normalized.replace(/\.git$/, '');

  // Handle SSH format: git@github.com:user/repo
  const sshMatch = normalized.match(/^[\w-]+@[\w.-]+:(.+)$/);
  if (sshMatch) {
    return sshMatch[1];
  }

  // Handle HTTPS/SSH URL format
  try {
    const url = new URL(normalized);
    // Remove leading slash
    return url.pathname.replace(/^\//, '');
  } catch {
    // If URL parsing fails, take last two segments
    const segments = normalized.split('/').filter(Boolean);
    return segments.slice(-2).join('/');
  }
}
