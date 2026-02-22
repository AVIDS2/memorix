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
  // This prevents home dirs, system dirs, and IDE config dirs from
  // becoming phantom projects with garbage data directories.
  if (!isValidProjectRoot(rootPath)) {
    // Use a generic sentinel ID — data will NOT be persisted
    console.error(`[memorix] Skipped invalid project root: ${rootPath}`);
    return { id: '__invalid__', name: 'unknown', rootPath };
  }

  // Fallback: use "local/<dirname>" to distinguish non-git projects
  const name = path.basename(rootPath);
  const id = `local/${name}`;
  console.error(`[memorix] Warning: no git remote found at ${rootPath}, using fallback projectId: ${id}`);
  return { id, name, rootPath };
}

/**
 * Check whether a directory looks like a real project root.
 * Returns false for home directories, OS system directories,
 * drive roots, and IDE/tool configuration directories.
 */
function isValidProjectRoot(dirPath: string): boolean {
  const resolved = path.resolve(dirPath);
  const home = path.resolve(os.homedir());

  // Reject the home directory itself (e.g., C:\Users\Lenovo, /home/user)
  if (resolved === home) return false;

  // Reject drive roots (C:\, D:\, /)
  if (resolved === path.parse(resolved).root) return false;

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
      return false;
    }
  }

  // Must have at least ONE project indicator file
  const projectIndicators = [
    'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml',
    'setup.py', 'pom.xml', 'build.gradle', 'Makefile',
    'CMakeLists.txt', 'composer.json', 'Gemfile',
    '.git', 'README.md', 'README',
  ];
  return projectIndicators.some(f => existsSync(path.join(resolved, f)));
}

/**
 * Walk up from cwd to find the nearest directory containing package.json.
 * Useful for non-git projects where the MCP server CWD may differ from project root.
 */
function findPackageRoot(cwd: string): string | null {
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  while (dir !== root) {
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
  try {
    const root = execSync('git -c safe.directory=* rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return root || null;
  } catch {
    // Fallback: walk up to find .git directory
    let dir = path.resolve(cwd);
    const fsRoot = path.parse(dir).root;
    while (dir !== fsRoot) {
      if (existsSync(path.join(dir, '.git'))) return dir;
      dir = path.dirname(dir);
    }
    return null;
  }
}

/**
 * Get the Git remote URL for the given directory.
 * Returns null if not a git repository or no remote configured.
 */
function getGitRemote(cwd: string): string | null {
  try {
    const remote = execSync('git -c safe.directory=* remote get-url origin', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return remote || null;
  } catch {
    // Fallback: read .git/config directly (handles dubious ownership on Windows)
    return readGitConfigRemote(cwd);
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
