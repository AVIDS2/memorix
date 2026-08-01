/**
 * Git Worktree — Phase 6i: Parallel agent isolation.
 *
 * Each parallel agent gets its own working directory + branch via
 * git worktree. Prevents file conflicts during concurrent execution.
 * Startup cleanup handles orphaned worktrees (pays D6 debt).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';

// ── Types ──────────────────────────────────────────────────────────

export interface WorktreeInfo {
  worktreePath: string;
  branch: string;
}

// ── Constants ──────────────────────────────────────────────────────

const WORKTREE_DIR = '.worktrees';

function runGit(cwd: string, args: string[], timeout = 5_000): string {
  return String(execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    timeout,
    windowsHide: true,
  }));
}

function formatGitError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasUncommittedChanges(worktreePath: string): boolean | null {
  try {
    return runGit(worktreePath, ['status', '--porcelain']).trim().length > 0;
  } catch {
    return null;
  }
}

function isBranchMergedIntoHead(projectDir: string, branch: string): boolean {
  try {
    runGit(projectDir, ['merge-base', '--is-ancestor', branch, 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

function isManagedWorktreePath(worktreePath: string, worktreeBase: string): boolean {
  const normalize = (value: string) => {
    const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  const path = normalize(worktreePath);
  const base = normalize(worktreeBase);
  return path === base || path.startsWith(`${base}/`);
}

// ── Create ─────────────────────────────────────────────────────────

/**
 * Create an isolated git worktree for a task.
 * The worktree lives at `<projectDir>/.worktrees/task-<shortId>/`
 * on branch `pipeline/<pipelineId>/task-<shortId>`.
 */
export function createWorktree(
  projectDir: string,
  taskId: string,
  pipelineId: string,
): WorktreeInfo {
  const shortId = taskId.slice(0, 8);
  const shortPipeline = pipelineId.slice(0, 8);
  const worktreeBase = join(projectDir, WORKTREE_DIR, `task-${shortId}`);
  const branchBase = `pipeline/${shortPipeline}/task-${shortId}`;

  // A failed attempt is preserved for recovery. Pick a new suffix for retries
  // instead of reusing and overwriting that evidence.
  for (let attempt = 1; attempt <= 100; attempt++) {
    const suffix = attempt === 1 ? '' : `-${attempt}`;
    const worktreePath = `${worktreeBase}${suffix}`;
    const branch = `${branchBase}${suffix}`;
    if (existsSync(worktreePath)) continue;
    // Check refs before merge-base so a fresh branch does not emit Git's
    // noisy "Not a valid object name" diagnostic on every allocation.
    if (!isBranchAvailable(projectDir, branch)) continue;

    runGit(projectDir, ['worktree', 'add', '-b', branch, worktreePath], 30_000);
    return { worktreePath, branch };
  }

  throw new Error(`Unable to allocate an isolated worktree for task ${shortId}`);
}

function isBranchAvailable(projectDir: string, branch: string): boolean {
  try {
    runGit(projectDir, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    return false;
  } catch {
    return true;
  }
}

// ── Merge ──────────────────────────────────────────────────────────

export interface MergeResult {
  success: boolean;
  conflicts?: string;
}

/**
 * Commit any uncommitted changes in the worktree, then merge the worktree
 * branch back into the current branch in projectDir.
 * Returns success=false with conflict details if merge fails.
 *
 * @param worktreePath - path to the worktree directory (for add+commit)
 * @param projectDir - path to the main repo (for merge)
 * @param branch - the worktree branch name
 */
export function mergeWorktree(
  projectDir: string,
  branch: string,
  worktreePath?: string,
): MergeResult {
  // Step 1: Commit any agent-produced changes in the worktree.
  // Without this, files written by the agent are untracked and the merge
  // will be a no-op (no commits on the branch beyond the checkout base).
  if (worktreePath) {
    const changes = hasUncommittedChanges(worktreePath);
    if (changes === null) {
      return {
        success: false,
        conflicts: `Could not inspect worktree changes; preserved at ${worktreePath}.`,
      };
    }
    if (changes) {
      try {
        runGit(worktreePath, ['add', '-A'], 15_000);
        runGit(worktreePath, ['commit', '-m', 'task: agent work', '--no-verify'], 15_000);
      } catch (error) {
        return {
          success: false,
          conflicts: `Could not commit agent changes; preserved at ${worktreePath}. ${formatGitError(error)}`,
        };
      }
    }
  }

  // Step 2: Merge the branch into the main repo.
  try {
    runGit(projectDir, ['merge', '--no-ff', branch, '-m', `merge: ${branch}`], 30_000);
    return { success: true };
  } catch (err) {
    // Abort the failed merge to leave working tree clean
    try {
      runGit(projectDir, ['merge', '--abort']);
    } catch { /* best-effort */ }

    return { success: false, conflicts: formatGitError(err) };
  }
}

// ── Remove ─────────────────────────────────────────────────────────

/**
 * Remove a worktree and optionally delete the branch.
 */
export function removeWorktree(
  projectDir: string,
  worktreePath: string,
  branch?: string,
): void {
  try {
    runGit(projectDir, ['worktree', 'remove', worktreePath, '--force'], 10_000);
  } catch {
    // If git worktree remove fails, try manual cleanup
    if (existsSync(worktreePath)) {
      try { rmSync(worktreePath, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    try {
      runGit(projectDir, ['worktree', 'prune']);
    } catch { /* best-effort */ }
  }

  // Delete the branch (best-effort)
  if (branch) {
    try {
      runGit(projectDir, ['branch', '-D', branch]);
    } catch { /* may already be deleted or is current branch */ }
  }
}

// ── Cleanup Orphans ────────────────────────────────────────────────

/**
 * List existing worktrees under .worktrees/ directory.
 * Returns array of { path, branch } from `git worktree list --porcelain`.
 */
export function listWorktrees(projectDir: string): Array<{ path: string; branch: string | null }> {
  try {
    const raw = runGit(projectDir, ['worktree', 'list', '--porcelain']);

    const worktrees: Array<{ path: string; branch: string | null }> = [];
    let current: { path: string; branch: string | null } | null = null;

    for (const line of raw.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current) worktrees.push(current);
        current = { path: line.slice('worktree '.length).trim(), branch: null };
      } else if (line.startsWith('branch ') && current) {
        // branch refs/heads/pipeline/xxx/task-yyy
        const ref = line.slice('branch '.length).trim();
        current.branch = ref.replace('refs/heads/', '');
      }
    }
    if (current) worktrees.push(current);

    // Filter to only our managed worktrees; require a path boundary so a
    // sibling such as `.worktrees-old` is never treated as ours.
    const worktreeBase = join(projectDir, WORKTREE_DIR);
    return worktrees.filter(w => isManagedWorktreePath(w.path, worktreeBase));
  } catch {
    return [];
  }
}

/**
 * Extract taskId from a worktree path.
 * Path format: .../task-<shortId>
 */
export function extractTaskIdFromPath(worktreePath: string): string | null {
  const name = basename(worktreePath);
  const match = name.match(/^task-([a-f0-9]+)(?:-\d+)?$/);
  return match ? match[1] : null;
}

/**
 * Clean up orphaned worktrees — those whose tasks no longer exist or are terminal.
 * Call this at coordinator startup.
 *
 * @param isTaskTerminal - callback to check if a task (by short ID prefix) is done/nonexistent
 * @returns number of worktrees removed
 */
export function cleanupOrphanWorktrees(
  projectDir: string,
  isTaskTerminal: (shortId: string) => boolean,
): number {
  const worktrees = listWorktrees(projectDir);
  let removed = 0;

  for (const wt of worktrees) {
    const shortId = extractTaskIdFromPath(wt.path);
    if (!shortId) continue;

    if (isTaskTerminal(shortId)) {
      const changes = hasUncommittedChanges(wt.path);
      if (changes === false && wt.branch && isBranchMergedIntoHead(projectDir, wt.branch)) {
        removeWorktree(projectDir, wt.path, wt.branch);
        removed++;
      }
    }
  }

  return removed;
}
