/**
 * Project Detector
 *
 * Identifies the current project using Git remote URL.
 * Source: shared-agent-memory's Git-based project isolation pattern.
 *
 * Extensible: fallback strategies can be added for non-git projects
 * (e.g., package.json name, directory name, etc.)
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProjectInfo } from '../types.js';

/**
 * Detect the current project identity from Git remote or fallback.
 * @param cwd - Working directory to detect from (defaults to process.cwd())
 */
export function detectProject(cwd?: string): ProjectInfo {
  const basePath = cwd ?? process.cwd();
  // Priority: git root > package.json dir > CWD
  const rootPath = getGitRoot(basePath) ?? findPackageRoot(basePath) ?? basePath;
  const gitRemote = getGitRemote(rootPath);

  if (gitRemote) {
    const id = normalizeGitRemote(gitRemote);
    const name = id.split('/').pop() ?? path.basename(rootPath);
    return { id, name, gitRemote, rootPath };
  }

  // Validate the root before creating a fallback project.
  // Home dirs, system dirs, etc. get a "placeholder" prefix so data is still
  // persisted and tools are usable, but the user gets a warning to set a proper root.
  if (isDangerousRoot(rootPath)) {
    const name = path.basename(rootPath) || 'unknown';
    const id = `placeholder/${name}`;
    console.error(`[memorix] WARNING: cwd "${rootPath}" is not a project directory — using degraded mode (${id})`);
    console.error(`[memorix] For best results, set MEMORIX_PROJECT_ROOT or --cwd to your project path.`);
    return { id, name, rootPath };
  }

  // Fallback: use "local/<dirname>" — works for non-git and empty directories
  const name = path.basename(rootPath);
  const id = `local/${name}`;
  return { id, name, rootPath };
}

/**
 * Check whether a directory is a dangerous/invalid project root.
 * Returns TRUE for home directories, OS system directories,
 * drive roots, and IDE/tool configuration directories.
 * Returns FALSE for normal directories (including empty ones).
 */
function isDangerousRoot(dirPath: string): boolean {
  const resolved = path.resolve(dirPath);
  const home = path.resolve(os.homedir());

  // Reject the home directory itself (e.g., C:\Users\Lenovo, /home/user)
  if (resolved === home) return true;

  // Reject drive roots (C:\, D:\, /)
  if (resolved === path.parse(resolved).root) return true;

  // Reject immediate children of home that are IDE/tool config dirs
  const basename = path.basename(resolved).toLowerCase();
  const knownNonProjectDirs = new Set([
    // IDE / editor config dirs
    '.vscode', '.cursor', '.windsurf', '.kiro', '.codex',
    '.gemini', '.claude', '.github', '.git',
    // OS / system dirs
    'desktop', 'documents', 'downloads', 'pictures', 'videos', 'music',
    'appdata', 'application data', 'library',
    // Package manager / tool dirs
    'node_modules', '.npm', '.yarn', '.pnpm-store',
    '.config', '.local', '.cache', '.ssh', '.memorix',
  ]);
  if (knownNonProjectDirs.has(basename)) {
    const parent = path.resolve(path.dirname(resolved));
    // Only block if it's directly under home or a drive root
    if (parent === home || parent === path.parse(parent).root) {
      return true;
    }
  }

  return false;
}

/**
 * Walk up from cwd to find the nearest directory containing package.json.
 * Useful for non-git projects where the MCP server CWD may differ from project root.
 */
function findPackageRoot(cwd: string): string | null {
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  while (dir !== root) {
    // Stop walking if we hit a dangerous directory (home dir, system dir)
    if (isDangerousRoot(dir)) return null;
    if (existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
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
