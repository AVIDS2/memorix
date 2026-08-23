import { createHash } from 'node:crypto';
import { getDatabase } from '../store/sqlite-db.js';

export const DEFAULT_FALLBACK_TTL_MS = 10 * 60 * 1000;

export interface FallbackClaim {
  allowed: boolean;
  key: string;
  reason?: string;
  count: number;
}

export function fallbackRequestKey(projectId: string, task: string | undefined): string {
  const normalized = (task ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(`${projectId}\n${normalized}`).digest('hex').slice(0, 32);
}

/**
 * Durable one-shot fallback guard. A failed MCP discovery must not turn into a
 * loop of help/search/status probes; one bounded context request is enough.
 */
export class CliFallbackBudget {
  private db: any = null;

  async init(dataDir: string): Promise<void> {
    this.db = getDatabase(dataDir);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cli_fallback_attempts (
        project_id TEXT NOT NULL,
        request_key TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, request_key)
      )
    `);
  }

  claim(projectId: string, task: string | undefined, now = Date.now(), ttlMs = DEFAULT_FALLBACK_TTL_MS): FallbackClaim {
    if (!this.db) throw new Error('CliFallbackBudget is not initialized.');
    const key = fallbackRequestKey(projectId, task);
    const current = this.db.prepare(`
      SELECT count, expires_at FROM cli_fallback_attempts WHERE project_id = ? AND request_key = ?
    `).get(projectId, key);
    const count = Number(current?.count ?? 0);
    if (current && Number(current.expires_at) > now && count >= 1) {
      return { allowed: false, key, count, reason: 'Fallback budget exhausted for this task. Stop probing and continue with the current project files.' };
    }
    this.db.prepare(`
      INSERT INTO cli_fallback_attempts (project_id, request_key, count, last_attempt_at, expires_at)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(project_id, request_key) DO UPDATE SET
        count = CASE WHEN excluded.expires_at > cli_fallback_attempts.expires_at THEN 1 ELSE cli_fallback_attempts.count + 1 END,
        last_attempt_at = excluded.last_attempt_at,
        expires_at = CASE WHEN excluded.expires_at > cli_fallback_attempts.expires_at THEN excluded.expires_at ELSE cli_fallback_attempts.expires_at END
    `).run(projectId, key, now, now + Math.max(1_000, ttlMs));
    return { allowed: true, key, count: 1 };
  }
}
