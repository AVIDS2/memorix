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
import type { ProjectInfo, DetectionResult, DetectionFailure } from '../types.js';

/**
 * Detect the current project identity from Git.
 * Returns null if no .git directory is found — caller must handle this.
 * @param cwd - Working directory to detect from (defaults to process.cwd())
 */
export function detectProject(cwd?: string): ProjectInfo | null {
  return detectProjectWithDiagnostics(cwd).project;
}

/**
 * Detect project with full diagnostic info.
 * Returns both the project (if found) and a failure descriptor (if not).
 * Callers can use failure.reason to produce actionable error messages.
 */
export function detectProjectWithDiagnostics(cwd?: string): DetectionResult {
  const basePath = cwd ?? process.cwd();

  // Check: does the path exist?
  if (!existsSync(basePath)) {
    return {
      project: null,
      failure: { reason: 'path_not_found', path: basePath, detail: `Path does not exist: "${basePath}"` },
    };
  }

  // Check: is it a directory?
  try {
    if (!statSync(basePath).isDirectory()) {
      return {
        project: null,
        failure: { reason: 'not_a_directory', path: basePath, detail: `Path is not a directory: "${basePath}"` },
      };
    }
  } catch {
    return {
      project: null,
      failure: { reason: 'path_not_found', path: basePath, detail: `Cannot stat path: "${basePath}"` },
    };
  }

  // Check: git root
  const gitRootResult = getGitRootWithDiagnostics(basePath);
  if (!gitRootResult.root) {
    return {
      project: null,
      failure: gitRootResult.failure ?? {
        reason: 'no_git',
        path: basePath,
        detail: `No .git directory found in "${basePath}" or any parent directory.`,
      },
    };
  }

  const gitRoot = gitRootResult.root;
  const gitRemote = getGitRemote(gitRoot);

  if (gitRemote) {
    const id = normalizeGitRemote(gitRemote);
    const name = id.split('/').pop() ?? path.basename(gitRoot);
    return { project: { id, name, gitRemote, rootPath: gitRoot }, failure: null };
  }

  // Git repo without remote — local-only project
  const name = path.basename(gitRoot);
  const id = `local/${name}`;
  return { project: { id, name, rootPath: gitRoot }, failure: null };
}

/**
 * Get the Git repository root directory.
 * Returns null if not inside a git repository.
 */
function getGitRoot(cwd: string): string | null {
  return getGitRootWithDiagnostics(cwd).root;
}

/**
 * Get git root with diagnostic failure info.
 * Distinguishes: no_git, git_worktree_error, git_safe_directory.
 */
function getGitRootWithDiagnostics(cwd: string): { root: string | null; failure: DetectionFailure | null } {
  // Fast path: walk up to find .git directory (instant, no subprocess)
  let dir = path.resolve(cwd);
  const fsRoot = path.parse(dir).root;
  while (dir !== fsRoot) {
    const gitPath = path.join(dir, '.git');
    if (existsSync(gitPath)) {
      // .git may be a file (worktree) or directory (normal repo)
      try {
        const st = statSync(gitPath);
        if (st.isDirectory() || st.isFile()) return { root: dir, failure: null };
      } catch {
        return {
          root: null,
          failure: {
            reason: 'git_worktree_error',
            path: cwd,
            detail: `Found .git at "${gitPath}" but cannot stat it (permission denied or broken worktree link).`,
          },
        };
      }
    }
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
    return root ? { root, failure: null } : { root: null, failure: null };
  } catch (err) {
    // Inspect stderr for known git error patterns
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('safe.directory') || msg.includes('dubious ownership')) {
      return {
        root: null,
        failure: {
          reason: 'git_safe_directory',
          path: cwd,
          detail: `Git refuses to operate in "${cwd}" due to ownership/safe.directory restrictions. ` +
            'Run: git config --global --add safe.directory "' + cwd + '"',
        },
      };
    }
    return {
      root: null,
      failure: { reason: 'no_git', path: cwd, detail: `No git repository found at "${cwd}" or any parent directory.` },
    };
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
 * Detect if a directory is a "system directory" that's clearly not a user workspace.
 * These include Windows system dirs, IDE installation dirs, and temp dirs.
 */
export function isSystemDirectory(dir: string): boolean {
  const lower = dir.toLowerCase().replace(/\\/g, '/');
  return (
    lower.includes('/windows/') || lower.endsWith('/windows') ||
    lower.includes('/program files') ||
    lower.includes('/appdata/') ||
    // IDE installation directories
    /\/(windsurf|cursor|code|vscode)\/\1/i.test(lower) ||
    /\/windsurf\b/i.test(lower) && !lower.includes('.windsurf') ||
    // Node / npm internal paths
    lower.includes('/node_modules/') ||
    lower.includes('/nvm') ||
    // System root
    /^[a-z]:\/$/i.test(lower)
  );
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
