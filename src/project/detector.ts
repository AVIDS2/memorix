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
import { existsSync } from 'node:fs';
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

  // Fallback: use "local/<dirname>" to distinguish non-git projects
  // This avoids creating garbage directories named after IDEs or system paths
  const name = path.basename(rootPath);
  const id = `local/${name}`;
  console.error(`[memorix] Warning: no git remote found at ${rootPath}, using fallback projectId: ${id}`);
  return { id, name, rootPath };
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
    const root = execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
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
  try {
    const remote = execSync('git remote get-url origin', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return remote || null;
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
