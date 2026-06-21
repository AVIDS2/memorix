/**
 * Team State Persistence - File-based shared state for orchestration coordination
 *
 * In stdio mode, each IDE spawns its own MCP process with isolated in-memory team state.
 * This persistence layer writes team state to a shared JSON file so all MCP processes
 * (Windsurf, Cursor, Claude Code, Antigravity, etc.) see the same agents, messages,
 * locks, and tasks.
 *
 * sync() — reload from disk if file changed (mtime check)
 * flush() — atomic write to disk (write tmp + rename)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { statSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentRegistry } from './registry.js';
import type { MessageBus } from './messages.js';
import type { TaskManager } from './tasks.js';
import type { FileLockRegistry } from './file-locks.js';

// ─── Types ───────────────────────────────────────────────────────────

interface TeamStateSnapshot {
  version: 1;
  updatedAt: string;
  registry: ReturnType<AgentRegistry['serialize']>;
  messages: ReturnType<MessageBus['serialize']>;
  tasks: ReturnType<TaskManager['serialize']>;
  locks: ReturnType<FileLockRegistry['serialize']>;
}

// ─── Persistence ─────────────────────────────────────────────────────

export class TeamPersistence {
  private lastMtimeMs = 0;

  constructor(
    private filePath: string,
    private registry: AgentRegistry,
    private messageBus: MessageBus,
    private taskManager: TaskManager,
    private fileLocks: FileLockRegistry,
  ) {}

  /** Reload state from disk if the file changed since last read */
  async sync(): Promise<void> {
    try {
      if (!existsSync(this.filePath)) return;
      const st = statSync(this.filePath);
      if (st.mtimeMs <= this.lastMtimeMs) return;
    } catch {
      return;
    }

    try {
      const raw = await readFile(this.filePath, 'utf8');
      const snap: TeamStateSnapshot = JSON.parse(raw);
      if (snap.version !== 1) return;

      this.registry.hydrate(snap.registry);
      this.messageBus.hydrate(snap.messages);
      this.taskManager.hydrate(snap.tasks);
      this.fileLocks.hydrate(snap.locks);

      try { this.lastMtimeMs = statSync(this.filePath).mtimeMs; } catch { /* */ }
    } catch {
      // Corrupted or partial write — ignore, will be overwritten on next flush
    }
  }

  /** Write current state to disk atomically (tmp + rename) */
  async flush(): Promise<void> {
    const snap: TeamStateSnapshot = {
      version: 1,
      updatedAt: new Date().toISOString(),
      registry: this.registry.serialize(),
      messages: this.messageBus.serialize(),
      tasks: this.taskManager.serialize(),
      locks: this.fileLocks.serialize(),
    };

    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.' + process.pid + '.tmp';
    await writeFile(tmp, JSON.stringify(snap, null, 2), 'utf8');

    try {
      renameSync(tmp, this.filePath);
    } catch {
      // Fallback: direct write if rename fails (cross-device)
      await writeFile(this.filePath, JSON.stringify(snap, null, 2), 'utf8');
      try { const { unlinkSync } = await import('node:fs'); unlinkSync(tmp); } catch { /* */ }
    }

    try { this.lastMtimeMs = statSync(this.filePath).mtimeMs; } catch { /* */ }
  }
}
