/**
 * File Lock & Atomic Write Utilities
 *
 * Provides cross-process file locking using .lock files with atomic creation
 * (O_CREAT | O_EXCL), and atomic file writes via temp-file-then-rename.
 *
 * This prevents data corruption when multiple MCP server instances
 * (e.g., Cursor + Windsurf) write to the same project directory simultaneously.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Lock is considered stale after 10 seconds (process crash recovery) */
const LOCK_STALE_MS = 10_000;
/** Retry interval when waiting for lock */
const RETRY_INTERVAL_MS = 50;
/** Maximum retries before giving up (50ms × 60 = 3 seconds) */
const MAX_RETRIES = 60;

/**
 * Acquire a lock file atomically.
 * Uses O_WRONLY | O_CREAT | O_EXCL — fails if file already exists.
 * Handles stale locks from crashed processes.
 */
export async function acquireLock(lockPath: string): Promise<void> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const fd = await fs.open(lockPath, 'wx');
      await fd.writeFile(JSON.stringify({ pid: process.pid, time: Date.now() }));
      await fd.close();
      return;
    } catch (err: unknown) {
      const code = err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
      if (code === 'EEXIST') {
        // Lock exists — check if stale
        try {
          const stat = await fs.stat(lockPath);
          if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
            await fs.unlink(lockPath).catch(() => {});
            continue;
          }
        } catch {
          continue; // Lock disappeared — retry immediately
        }
        await new Promise(r => setTimeout(r, RETRY_INTERVAL_MS));
      } else {
        throw err;
      }
    }
  }
  // Last resort: force-remove stale lock and try once more
  await fs.unlink(lockPath).catch(() => {});
  try {
    const fd = await fs.open(lockPath, 'wx');
    await fd.writeFile(JSON.stringify({ pid: process.pid, time: Date.now() }));
    await fd.close();
    return;
  } catch {
    throw new Error(`Failed to acquire lock: ${lockPath} (timeout after ${MAX_RETRIES * RETRY_INTERVAL_MS}ms)`);
  }
}

/**
 * Release a lock file.
 */
export async function releaseLock(lockPath: string): Promise<void> {
  await fs.unlink(lockPath).catch(() => {});
}

/**
 * Execute a function while holding a project-level lock.
 * Ensures only one process writes to the project directory at a time.
 *
 * @param projectDir - The project data directory to lock
 * @param fn - The async function to execute while holding the lock
 * @returns The return value of fn
 */
export async function withFileLock<T>(projectDir: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = path.join(projectDir, '.memorix.lock');
  await acquireLock(lockPath);
  try {
    return await fn();
  } finally {
    await releaseLock(lockPath);
  }
}

/**
 * Write a file atomically: write to .tmp, then rename.
 * Prevents partial writes from corrupting data files on crash.
 *
 * On most filesystems, rename() is atomic within the same directory,
 * so readers always see either the old complete file or the new complete file.
 */
export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const tmpPath = filePath + `.tmp.${process.pid}`;
  await fs.writeFile(tmpPath, data, 'utf-8');
  await fs.rename(tmpPath, filePath);
}
