/**
 * File Lock & Atomic Write Utilities
 *
 * Provides cross-process file locking using .lock files with atomic creation
 * (O_CREAT | O_EXCL), and atomic file writes via temp-file-then-rename.
 *
 * This prevents data corruption when multiple MCP server instances
 * (e.g., Cursor + Windsurf) write to the same project directory simultaneously.
 */
/**
 * Acquire a lock file atomically.
 * Uses O_WRONLY | O_CREAT | O_EXCL — fails if file already exists.
 * Handles stale locks from crashed processes.
 */
export declare function acquireLock(lockPath: string): Promise<void>;
/**
 * Release a lock file.
 */
export declare function releaseLock(lockPath: string): Promise<void>;
/**
 * Execute a function while holding a project-level lock.
 * Ensures only one process writes to the project directory at a time.
 *
 * @param projectDir - The project data directory to lock
 * @param fn - The async function to execute while holding the lock
 * @returns The return value of fn
 */
export declare function withFileLock<T>(projectDir: string, fn: () => Promise<T>): Promise<T>;
/**
 * Write a file atomically: write to .tmp, then rename.
 * Prevents partial writes from corrupting data files on crash.
 *
 * On most filesystems, rename() is atomic within the same directory,
 * so readers always see either the old complete file or the new complete file.
 */
export declare function atomicWriteFile(filePath: string, data: string): Promise<void>;
//# sourceMappingURL=file-lock.d.ts.map