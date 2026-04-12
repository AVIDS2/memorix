/**
 * Git Worktree — Phase 6i: Parallel agent isolation.
 *
 * Each parallel agent gets its own working directory + branch via
 * git worktree. Prevents file conflicts during concurrent execution.
 * Startup cleanup handles orphaned worktrees (pays D6 debt).
 */

import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';

// ── Types ──────────────────────────────────────────────────────────

export interface WorktreeInfo {
  worktreePath: string;
  branch: string;
}

// ── Constants ──────────────────────────────────────────────────────

const WORKTREE_DIR = '.worktrees';

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
  const worktreePath = join(projectDir, WORKTREE_DIR, `task-${shortId}`);
  const branch = `pipeline/${shortPipeline}/task-${shortId}`;

  // Ensure .worktrees directory exists (git worktree add handles the rest)
  execSync(`git worktree add "${worktreePath}" -b "${branch}"`, {
    cwd: projectDir,
    encoding: 'utf-8',
    timeout: 30_000,
  });

  return { worktreePath, branch };
}

// ── Merge ──────────────────────────────────────────────────────────

export interface MergeResult {
  success: boolean;
  conflicts?: string;
}

/**
 * Merge the worktree branch back into the current branch.
 * Returns success=false with conflict details if merge fails.
 */
export function mergeWorktree(
  projectDir: string,
  branch: string,
): MergeResult {
  try {
    execSync(`git merge --no-ff "${branch}" -m "merge: ${branch}"`, {
      cwd: projectDir,
      encoding: 'utf-8',
      timeout: 30_000,
    });
    return { success: true };
  } catch (err) {
    // Abort the failed merge to leave working tree clean
    try {
      execSync('git merge --abort', { cwd: projectDir, encoding: 'utf-8', timeout: 5_000 });
    } catch { /* best-effort */ }

    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, conflicts: msg };
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
    execSync(`git worktree remove "${worktreePath}" --force`, {
      cwd: projectDir,
      encoding: 'utf-8',
      timeout: 10_000,
    });
  } catch {
    // If git worktree remove fails, try manual cleanup
    if (existsSync(worktreePath)) {
      try { rmSync(worktreePath, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    try {
      execSync('git worktree prune', { cwd: projectDir, encoding: 'utf-8', timeout: 5_000 });
    } catch { /* best-effort */ }
  }

  // Delete the branch (best-effort)
  if (branch) {
    try {
      execSync(`git branch -D "${branch}"`, {
        cwd: projectDir,
        encoding: 'utf-8',
        timeout: 5_000,
      });
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
    const raw = execSync('git worktree list --porcelain', {
      cwd: projectDir,
      encoding: 'utf-8',
      timeout: 5_000,
    });

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

    // Filter to only our managed worktrees (normalize slashes for Windows compat)
    const worktreeBase = join(projectDir, WORKTREE_DIR).replace(/\\/g, '/');
    return worktrees.filter(w => w.path.replace(/\\/g, '/').startsWith(worktreeBase));
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
  const match = name.match(/^task-([a-f0-9]+)$/);
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
      removeWorktree(projectDir, wt.path, wt.branch ?? undefined);
      removed++;
    }
  }

  return removed;
}
