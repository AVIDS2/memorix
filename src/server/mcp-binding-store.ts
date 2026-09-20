import { randomUUID } from 'node:crypto';
import { getDatabase } from '../store/sqlite-db.js';

export const DEFAULT_MCP_BINDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface McpProjectBinding {
  handleId: string;
  projectId: string;
  projectRoot: string;
  dataDir: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt?: string;
}

function rowToBinding(row: any): McpProjectBinding {
  return {
    handleId: String(row.handle_id),
    projectId: String(row.project_id),
    projectRoot: String(row.project_root),
    dataDir: String(row.data_dir),
    createdAt: String(row.created_at),
    lastUsedAt: String(row.last_used_at),
    ...(row.expires_at ? { expiresAt: String(row.expires_at) } : {}),
  };
}

/** Durable project binding handles for stateless MCP requests. */
export class McpBindingStore {
  private db: any = null;

  async init(dataDir: string): Promise<void> {
    this.db = getDatabase(dataDir);
  }

  private requireDb(): any {
    if (!this.db) throw new Error('McpBindingStore is not initialized.');
    return this.db;
  }

  create(input: { projectId: string; projectRoot: string; dataDir: string; ttlMs?: number }): McpProjectBinding {
    const now = new Date();
    const ttlMs = input.ttlMs ?? DEFAULT_MCP_BINDING_TTL_MS;
    const binding: McpProjectBinding = {
      handleId: `mxh_${randomUUID().replace(/-/g, '')}`,
      projectId: input.projectId,
      projectRoot: input.projectRoot,
      dataDir: input.dataDir,
      createdAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      ...(ttlMs > 0 ? { expiresAt: new Date(now.getTime() + ttlMs).toISOString() } : {}),
    };
    this.requireDb().prepare(`
      INSERT INTO mcp_bindings (handle_id, project_id, project_root, data_dir, created_at, last_used_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(binding.handleId, binding.projectId, binding.projectRoot, binding.dataDir, binding.createdAt, binding.lastUsedAt, binding.expiresAt ?? null);
    return binding;
  }

  get(handleId: string): McpProjectBinding | undefined {
    const row = this.requireDb().prepare(`SELECT * FROM mcp_bindings WHERE handle_id = ?`).get(handleId);
    if (!row) return undefined;
    const binding = rowToBinding(row);
    if (binding.expiresAt && Date.parse(binding.expiresAt) <= Date.now()) {
      this.delete(handleId);
      return undefined;
    }
    return binding;
  }

  touch(handleId: string): McpProjectBinding | undefined {
    const binding = this.get(handleId);
    if (!binding) return undefined;
    const lastUsedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + DEFAULT_MCP_BINDING_TTL_MS).toISOString();
    this.requireDb().prepare(`UPDATE mcp_bindings SET last_used_at = ?, expires_at = ? WHERE handle_id = ?`).run(lastUsedAt, expiresAt, handleId);
    return { ...binding, lastUsedAt, expiresAt };
  }

  cleanupExpired(now = Date.now()): number {
    const result = this.requireDb().prepare(
      `DELETE FROM mcp_bindings WHERE expires_at IS NOT NULL AND expires_at <= ?`,
    ).run(new Date(now).toISOString());
    return Number(result.changes ?? 0);
  }

  /** Reuse the most recent valid extension handle for a verified project root. */
  findByProjectRoot(projectRoot: string): McpProjectBinding | undefined {
    const row = this.requireDb().prepare(`
      SELECT * FROM mcp_bindings
      WHERE project_root = ?
      ORDER BY last_used_at DESC
      LIMIT 1
    `).get(projectRoot);
    if (!row) return undefined;
    const binding = rowToBinding(row);
    if (binding.expiresAt && Date.parse(binding.expiresAt) <= Date.now()) {
      this.delete(binding.handleId);
      return undefined;
    }
    return binding;
  }

  delete(handleId: string): void {
    this.requireDb().prepare(`DELETE FROM mcp_bindings WHERE handle_id = ?`).run(handleId);
  }
}
