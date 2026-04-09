/**
 * TeamStore — SQLite-backed persistence for team collaboration state.
 *
 * Phase 4a: Replaces the file-based team-state.json persistence with
 * SQLite prepared statements on the shared DB handle (memorix.db).
 *
 * Provides:
 *   - Singleton init/get/reset pattern (same as SessionStore)
 *   - Shared DB handle via getDatabase()
 *   - One-time migration from team-state.json
 *   - Prepared statements for all team CRUD operations
 *
 * All team modules (registry, messages, tasks, locks) delegate to this store.
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../store/sqlite-db.js';
import path from 'node:path';
import fs from 'node:fs';

// ── Types ───────────────────────────────────────────────────────────

export interface TeamAgentRow {
  agent_id: string;
  project_id: string;
  agent_type: string;
  instance_id: string;
  name: string;
  role: string | null;
  capabilities: string | null; // JSON array
  status: 'active' | 'inactive';
  joined_at: number;
  last_heartbeat: number;
  left_at: number | null;
  last_seen_obs_generation: number;
}

export interface TeamMessageRow {
  id: string;
  project_id: string;
  sender_agent_id: string;
  recipient_agent_id: string | null; // NULL = broadcast
  type: string;
  content: string;
  payload: string | null; // JSON
  task_id: string | null;
  read_at: number | null;
  created_at: number;
}

export interface TeamTaskRow {
  task_id: string;
  project_id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  assignee_agent_id: string | null;
  result: string | null;
  metadata: string | null; // JSON
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface TeamLockRow {
  file: string;
  project_id: string;
  locked_by: string;
  locked_at: number;
  expires_at: number;
}

// ── TeamStore ────────────────────────────────────────────────────────

export class TeamStore {
  private db: any = null;
  private dataDir: string = '';

  // ── Agent prepared statements
  private stmtAgentUpsert: any = null;
  private stmtAgentFindByInstance: any = null;
  private stmtAgentFindById: any = null;
  private stmtAgentListByProject: any = null;
  private stmtAgentUpdateHeartbeat: any = null;
  private stmtAgentLeave: any = null;
  private stmtAgentUpdateWatermark: any = null;

  // ── Message prepared statements
  private stmtMsgInsert: any = null;
  private stmtMsgInbox: any = null;
  private stmtMsgMarkRead: any = null;
  private stmtMsgMarkAllRead: any = null;
  private stmtMsgUnreadCount: any = null;
  private stmtMsgPruneRead: any = null;
  private stmtMsgClearInbox: any = null;
  private stmtMsgById: any = null;

  // ── Task prepared statements
  private stmtTaskInsert: any = null;
  private stmtTaskClaim: any = null;
  private stmtTaskReClaim: any = null;
  private stmtTaskComplete: any = null;
  private stmtTaskFail: any = null;
  private stmtTaskRelease: any = null;
  private stmtTaskReleaseByAgent: any = null;
  private stmtTaskById: any = null;
  private stmtTaskListByProject: any = null;
  private stmtTaskAvailable: any = null;
  private stmtTaskDepInsert: any = null;
  private stmtTaskDepsByTask: any = null;
  private stmtTaskUnmetDeps: any = null;

  // ── Lock prepared statements
  private stmtLockUpsert: any = null;
  private stmtLockGet: any = null;
  private stmtLockDelete: any = null;
  private stmtLockListByProject: any = null;
  private stmtLockListByAgent: any = null;
  private stmtLockDeleteByAgent: any = null;
  private stmtLockDeleteExpired: any = null;

  async init(dataDir: string): Promise<void> {
    this.dataDir = dataDir;
    this.db = getDatabase(dataDir);

    this.prepareAgentStatements();
    this.prepareMessageStatements();
    this.prepareTaskStatements();
    this.prepareLockStatements();

    // One-time migration from team-state.json
    await this.migrateFromJsonIfNeeded();
  }

  // ── Agent statements ──────────────────────────────────────────────

  private prepareAgentStatements(): void {
    this.stmtAgentUpsert = this.db.prepare(`
      INSERT INTO team_agents
        (agent_id, project_id, agent_type, instance_id, name, role, capabilities, status, joined_at, last_heartbeat, left_at, last_seen_obs_generation)
      VALUES
        (@agent_id, @project_id, @agent_type, @instance_id, @name, @role, @capabilities, @status, @joined_at, @last_heartbeat, @left_at, @last_seen_obs_generation)
      ON CONFLICT(project_id, agent_type, instance_id) DO UPDATE SET
        name = excluded.name,
        role = excluded.role,
        capabilities = excluded.capabilities,
        status = excluded.status,
        last_heartbeat = excluded.last_heartbeat,
        left_at = excluded.left_at
    `);

    this.stmtAgentFindByInstance = this.db.prepare(
      `SELECT * FROM team_agents WHERE project_id = ? AND agent_type = ? AND instance_id = ?`
    );

    this.stmtAgentFindById = this.db.prepare(
      `SELECT * FROM team_agents WHERE agent_id = ?`
    );

    this.stmtAgentListByProject = this.db.prepare(
      `SELECT * FROM team_agents WHERE project_id = ? ORDER BY joined_at DESC`
    );

    this.stmtAgentUpdateHeartbeat = this.db.prepare(
      `UPDATE team_agents SET last_heartbeat = ? WHERE agent_id = ?`
    );

    this.stmtAgentLeave = this.db.prepare(
      `UPDATE team_agents SET status = 'inactive', left_at = ? WHERE agent_id = ?`
    );

    this.stmtAgentUpdateWatermark = this.db.prepare(
      `UPDATE team_agents SET last_seen_obs_generation = ?, last_heartbeat = ? WHERE agent_id = ?`
    );
  }

  // ── Message statements ────────────────────────────────────────────

  private prepareMessageStatements(): void {
    this.stmtMsgInsert = this.db.prepare(`
      INSERT INTO team_messages
        (id, project_id, sender_agent_id, recipient_agent_id, type, content, payload, task_id, read_at, created_at)
      VALUES
        (@id, @project_id, @sender_agent_id, @recipient_agent_id, @type, @content, @payload, @task_id, @read_at, @created_at)
    `);

    // Inbox: messages where I am the recipient OR recipient is NULL (broadcast)
    this.stmtMsgInbox = this.db.prepare(`
      SELECT * FROM team_messages
      WHERE project_id = ?
        AND (recipient_agent_id = ? OR recipient_agent_id IS NULL)
      ORDER BY created_at ASC
    `);

    this.stmtMsgMarkRead = this.db.prepare(
      `UPDATE team_messages SET read_at = ? WHERE id = ? AND read_at IS NULL`
    );

    this.stmtMsgMarkAllRead = this.db.prepare(
      `UPDATE team_messages SET read_at = ?
       WHERE project_id = ?
         AND (recipient_agent_id = ? OR recipient_agent_id IS NULL)
         AND read_at IS NULL`
    );

    this.stmtMsgUnreadCount = this.db.prepare(`
      SELECT COUNT(*) AS cnt FROM team_messages
      WHERE project_id = ?
        AND (recipient_agent_id = ? OR recipient_agent_id IS NULL)
        AND read_at IS NULL
    `);

    this.stmtMsgPruneRead = this.db.prepare(
      `DELETE FROM team_messages WHERE project_id = ? AND read_at IS NOT NULL AND read_at < ?`
    );

    this.stmtMsgClearInbox = this.db.prepare(
      `DELETE FROM team_messages WHERE project_id = ? AND recipient_agent_id = ?`
    );

    this.stmtMsgById = this.db.prepare(
      `SELECT * FROM team_messages WHERE id = ?`
    );
  }

  // ── Task statements ───────────────────────────────────────────────

  private prepareTaskStatements(): void {
    this.stmtTaskInsert = this.db.prepare(`
      INSERT INTO team_tasks
        (task_id, project_id, description, status, assignee_agent_id, result, metadata, created_by, created_at, updated_at)
      VALUES
        (@task_id, @project_id, @description, @status, @assignee_agent_id, @result, @metadata, @created_by, @created_at, @updated_at)
    `);

    // Atomic claim: WHERE guards prevent race conditions across processes
    this.stmtTaskClaim = this.db.prepare(`
      UPDATE team_tasks
      SET    assignee_agent_id = ?, status = 'in_progress', updated_at = ?
      WHERE  task_id = ? AND status = 'pending' AND assignee_agent_id IS NULL
    `);

    // Re-claim: same agent re-claiming its own task (idempotent)
    this.stmtTaskReClaim = this.db.prepare(`
      UPDATE team_tasks SET updated_at = ?
      WHERE  task_id = ? AND assignee_agent_id = ? AND status = 'in_progress'
    `);

    this.stmtTaskComplete = this.db.prepare(`
      UPDATE team_tasks
      SET    status = 'completed', result = ?, updated_at = ?
      WHERE  task_id = ? AND assignee_agent_id = ? AND status = 'in_progress'
    `);

    this.stmtTaskFail = this.db.prepare(`
      UPDATE team_tasks
      SET    status = 'failed', result = ?, updated_at = ?
      WHERE  task_id = ? AND assignee_agent_id = ? AND status = 'in_progress'
    `);

    this.stmtTaskRelease = this.db.prepare(`
      UPDATE team_tasks
      SET    status = 'pending', assignee_agent_id = NULL, updated_at = ?
      WHERE  task_id = ? AND assignee_agent_id = ? AND status = 'in_progress'
    `);

    // Stale rescue: release all tasks held by a departed agent
    this.stmtTaskReleaseByAgent = this.db.prepare(`
      UPDATE team_tasks
      SET    status = 'pending', assignee_agent_id = NULL, updated_at = ?
      WHERE  assignee_agent_id = ? AND status = 'in_progress'
    `);

    this.stmtTaskById = this.db.prepare(
      `SELECT * FROM team_tasks WHERE task_id = ?`
    );

    this.stmtTaskListByProject = this.db.prepare(
      `SELECT * FROM team_tasks WHERE project_id = ? ORDER BY created_at DESC`
    );

    this.stmtTaskAvailable = this.db.prepare(
      `SELECT * FROM team_tasks WHERE project_id = ? AND status = 'pending' AND assignee_agent_id IS NULL ORDER BY created_at ASC`
    );

    this.stmtTaskDepInsert = this.db.prepare(
      `INSERT OR IGNORE INTO team_task_deps (task_id, dep_task_id) VALUES (?, ?)`
    );

    this.stmtTaskDepsByTask = this.db.prepare(
      `SELECT dep_task_id FROM team_task_deps WHERE task_id = ?`
    );

    // Count unmet dependencies for a task
    this.stmtTaskUnmetDeps = this.db.prepare(`
      SELECT COUNT(*) AS cnt FROM team_task_deps d
        JOIN team_tasks t ON d.dep_task_id = t.task_id
      WHERE d.task_id = ? AND t.status != 'completed'
    `);
  }

  // ── Lock statements ───────────────────────────────────────────────

  private prepareLockStatements(): void {
    this.stmtLockUpsert = this.db.prepare(`
      INSERT INTO team_locks (file, project_id, locked_by, locked_at, expires_at)
      VALUES (@file, @project_id, @locked_by, @locked_at, @expires_at)
      ON CONFLICT(file, project_id) DO UPDATE SET
        locked_by = excluded.locked_by,
        locked_at = excluded.locked_at,
        expires_at = excluded.expires_at
    `);

    this.stmtLockGet = this.db.prepare(
      `SELECT * FROM team_locks WHERE file = ? AND project_id = ?`
    );

    this.stmtLockDelete = this.db.prepare(
      `DELETE FROM team_locks WHERE file = ? AND project_id = ?`
    );

    this.stmtLockListByProject = this.db.prepare(
      `SELECT * FROM team_locks WHERE project_id = ? ORDER BY locked_at DESC`
    );

    this.stmtLockListByAgent = this.db.prepare(
      `SELECT * FROM team_locks WHERE project_id = ? AND locked_by = ? ORDER BY locked_at DESC`
    );

    this.stmtLockDeleteByAgent = this.db.prepare(
      `DELETE FROM team_locks WHERE locked_by = ?`
    );

    this.stmtLockDeleteExpired = this.db.prepare(
      `DELETE FROM team_locks WHERE project_id = ? AND expires_at <= ?`
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // Agent Operations
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Register or reactivate an agent.
   * If an agent with the same (project_id, agent_type, instance_id) exists,
   * reactivate it (preserving agent_id). Otherwise create a new one.
   */
  registerAgent(input: {
    projectId: string;
    agentType: string;
    instanceId?: string;
    name?: string;
    role?: string;
    capabilities?: string[];
  }): TeamAgentRow {
    const instanceId = input.instanceId || randomUUID();
    const now = Date.now();

    // Check for existing agent by instance key
    const existing = this.stmtAgentFindByInstance.get(
      input.projectId, input.agentType, instanceId
    ) as TeamAgentRow | undefined;

    if (existing) {
      // Reactivate — preserve agent_id, update heartbeat and metadata
      this.stmtAgentUpsert.run({
        agent_id: existing.agent_id,
        project_id: input.projectId,
        agent_type: input.agentType,
        instance_id: instanceId,
        name: input.name ?? existing.name,
        role: input.role ?? existing.role,
        capabilities: input.capabilities ? JSON.stringify(input.capabilities) : existing.capabilities,
        status: 'active',
        joined_at: existing.joined_at,
        last_heartbeat: now,
        left_at: null,
        last_seen_obs_generation: existing.last_seen_obs_generation,
      });
      return this.stmtAgentFindById.get(existing.agent_id) as TeamAgentRow;
    }

    // New agent
    const agentId = randomUUID();
    this.stmtAgentUpsert.run({
      agent_id: agentId,
      project_id: input.projectId,
      agent_type: input.agentType,
      instance_id: instanceId,
      name: input.name || input.agentType,
      role: input.role ?? null,
      capabilities: input.capabilities ? JSON.stringify(input.capabilities) : null,
      status: 'active',
      joined_at: now,
      last_heartbeat: now,
      left_at: null,
      last_seen_obs_generation: 0,
    });
    return this.stmtAgentFindById.get(agentId) as TeamAgentRow;
  }

  getAgent(agentId: string): TeamAgentRow | undefined {
    return this.stmtAgentFindById.get(agentId) as TeamAgentRow | undefined;
  }

  getAgentByInstance(projectId: string, agentType: string, instanceId: string): TeamAgentRow | undefined {
    return this.stmtAgentFindByInstance.get(projectId, agentType, instanceId) as TeamAgentRow | undefined;
  }

  listAgents(projectId: string, filter?: { status?: 'active' | 'inactive' }): TeamAgentRow[] {
    const all = this.stmtAgentListByProject.all(projectId) as TeamAgentRow[];
    if (filter?.status) {
      return all.filter(a => a.status === filter.status);
    }
    return all;
  }

  heartbeat(agentId: string): boolean {
    const info = this.stmtAgentUpdateHeartbeat.run(Date.now(), agentId);
    return info.changes > 0;
  }

  leaveAgent(agentId: string): boolean {
    const info = this.stmtAgentLeave.run(Date.now(), agentId);
    return info.changes > 0;
  }

  updateWatermark(agentId: string, generation: number): void {
    this.stmtAgentUpdateWatermark.run(generation, Date.now(), agentId);
  }

  /**
   * Detect and mark stale agents. Returns list of stale agent IDs whose tasks/locks were released.
   */
  detectAndMarkStale(projectId: string, staleTtlMs: number): string[] {
    const threshold = Date.now() - staleTtlMs;
    const staleAgents = (this.stmtAgentListByProject.all(projectId) as TeamAgentRow[])
      .filter(a => a.status === 'active' && a.last_heartbeat < threshold);

    const staleIds: string[] = [];
    const now = Date.now();
    for (const agent of staleAgents) {
      this.stmtAgentLeave.run(now, agent.agent_id);
      // Release tasks
      this.stmtTaskReleaseByAgent.run(now, agent.agent_id);
      // Release locks
      this.stmtLockDeleteByAgent.run(agent.agent_id);
      staleIds.push(agent.agent_id);
    }
    return staleIds;
  }

  getActiveCount(projectId: string): number {
    return this.listAgents(projectId, { status: 'active' }).length;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Message Operations
  // ═══════════════════════════════════════════════════════════════════

  sendMessage(input: {
    projectId: string;
    senderAgentId: string;
    recipientAgentId?: string | null;
    type: string;
    content: string;
    payload?: Record<string, unknown>;
    taskId?: string;
  }): TeamMessageRow {
    const id = randomUUID();
    const now = Date.now();
    const row: TeamMessageRow = {
      id,
      project_id: input.projectId,
      sender_agent_id: input.senderAgentId,
      recipient_agent_id: input.recipientAgentId ?? null,
      type: input.type,
      content: input.content,
      payload: input.payload ? JSON.stringify(input.payload) : null,
      task_id: input.taskId ?? null,
      read_at: null,
      created_at: now,
    };
    this.stmtMsgInsert.run(row);
    return row;
  }

  getInbox(projectId: string, agentId: string): TeamMessageRow[] {
    return this.stmtMsgInbox.all(projectId, agentId) as TeamMessageRow[];
  }

  getUnreadCount(projectId: string, agentId: string): number {
    const row = this.stmtMsgUnreadCount.get(projectId, agentId) as { cnt: number };
    return row.cnt;
  }

  markMessageRead(messageId: string): boolean {
    const info = this.stmtMsgMarkRead.run(Date.now(), messageId);
    return info.changes > 0;
  }

  markAllRead(projectId: string, agentId: string): number {
    const info = this.stmtMsgMarkAllRead.run(Date.now(), projectId, agentId);
    return info.changes;
  }

  pruneReadMessages(projectId: string, olderThanMs: number): number {
    const threshold = Date.now() - olderThanMs;
    const info = this.stmtMsgPruneRead.run(projectId, threshold);
    return info.changes;
  }

  clearInbox(projectId: string, agentId: string): number {
    const info = this.stmtMsgClearInbox.run(projectId, agentId);
    return info.changes;
  }

  getMessageById(messageId: string): TeamMessageRow | undefined {
    return this.stmtMsgById.get(messageId) as TeamMessageRow | undefined;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Task Operations (with atomic claim semantics)
  // ═══════════════════════════════════════════════════════════════════

  createTask(input: {
    projectId: string;
    description: string;
    deps?: string[];
    metadata?: Record<string, unknown>;
    createdBy?: string;
  }): TeamTaskRow {
    const taskId = randomUUID();
    const now = Date.now();
    const row: TeamTaskRow = {
      task_id: taskId,
      project_id: input.projectId,
      description: input.description,
      status: 'pending',
      assignee_agent_id: null,
      result: null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      created_by: input.createdBy ?? null,
      created_at: now,
      updated_at: now,
    };
    this.stmtTaskInsert.run(row);

    // Insert dependencies
    if (input.deps?.length) {
      for (const depId of input.deps) {
        this.stmtTaskDepInsert.run(taskId, depId);
      }
    }
    return row;
  }

  getTask(taskId: string): TeamTaskRow | undefined {
    return this.stmtTaskById.get(taskId) as TeamTaskRow | undefined;
  }

  getTaskDeps(taskId: string): string[] {
    const rows = this.stmtTaskDepsByTask.all(taskId) as { dep_task_id: string }[];
    return rows.map(r => r.dep_task_id);
  }

  /**
   * Atomic task claim with dependency check.
   * Uses BEGIN IMMEDIATE to serialize the dep check + claim atomically.
   * Returns { success, task, reason? }.
   */
  claimTask(taskId: string, agentId: string): { success: boolean; task?: TeamTaskRow; reason?: string } {
    const claimTx = this.db.transaction(() => {
      const task = this.stmtTaskById.get(taskId) as TeamTaskRow | undefined;
      if (!task) return { success: false, reason: 'Task not found' };

      // Allow same agent to re-claim
      if (task.assignee_agent_id === agentId && task.status === 'in_progress') {
        const now = Date.now();
        this.stmtTaskReClaim.run(now, taskId, agentId);
        return { success: true, task: { ...task, updated_at: now } };
      }

      // Check unmet dependencies
      const unmet = this.stmtTaskUnmetDeps.get(taskId) as { cnt: number };
      if (unmet.cnt > 0) {
        return { success: false, reason: `Cannot claim: ${unmet.cnt} unmet dependency(ies)` };
      }

      // Atomic claim
      const now = Date.now();
      const info = this.stmtTaskClaim.run(agentId, now, taskId);
      if (info.changes === 0) {
        // Another process claimed it or status changed
        const current = this.stmtTaskById.get(taskId) as TeamTaskRow;
        return {
          success: false,
          reason: current.assignee_agent_id
            ? `Task already claimed by ${current.assignee_agent_id}`
            : `Task status is ${current.status}, not pending`,
        };
      }
      return { success: true, task: this.stmtTaskById.get(taskId) as TeamTaskRow };
    });

    // Use immediate to acquire write lock before reading
    return claimTx.immediate();
  }

  completeTask(taskId: string, agentId: string, result?: string): { success: boolean; reason?: string } {
    const now = Date.now();
    const info = this.stmtTaskComplete.run(result ?? null, now, taskId, agentId);
    if (info.changes === 0) {
      return { success: false, reason: 'Not the assignee or task not in progress' };
    }
    return { success: true };
  }

  failTask(taskId: string, agentId: string, result?: string): { success: boolean; reason?: string } {
    const now = Date.now();
    const info = this.stmtTaskFail.run(result ?? null, now, taskId, agentId);
    if (info.changes === 0) {
      return { success: false, reason: 'Not the assignee or task not in progress' };
    }
    return { success: true };
  }

  releaseTask(taskId: string, agentId: string): { success: boolean; reason?: string } {
    const now = Date.now();
    const info = this.stmtTaskRelease.run(now, taskId, agentId);
    if (info.changes === 0) {
      return { success: false, reason: 'Not the assignee or task not in progress' };
    }
    return { success: true };
  }

  releaseTasksByAgent(agentId: string): number {
    const now = Date.now();
    const info = this.stmtTaskReleaseByAgent.run(now, agentId);
    return info.changes;
  }

  listTasks(projectId: string, filter?: { status?: string; assignee?: string; available?: boolean }): TeamTaskRow[] {
    if (filter?.available) {
      return this.stmtTaskAvailable.all(projectId) as TeamTaskRow[];
    }
    const all = this.stmtTaskListByProject.all(projectId) as TeamTaskRow[];
    if (filter?.status) {
      return all.filter(t => t.status === filter.status);
    }
    if (filter?.assignee) {
      return all.filter(t => t.assignee_agent_id === filter.assignee);
    }
    return all;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Lock Operations
  // ═══════════════════════════════════════════════════════════════════

  private readonly DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes

  acquireLock(projectId: string, file: string, agentId: string, ttlMs?: number): { success: boolean; lockedBy: string } {
    const ttl = ttlMs ?? this.DEFAULT_LOCK_TTL_MS;
    const now = Date.now();

    // Clean expired lock for this file first
    this.stmtLockDeleteExpired.run(projectId, now);

    const existing = this.stmtLockGet.get(file, projectId) as TeamLockRow | undefined;
    if (existing) {
      if (existing.locked_by === agentId) {
        // Same agent — refresh TTL
        this.stmtLockUpsert.run({
          file,
          project_id: projectId,
          locked_by: agentId,
          locked_at: existing.locked_at,
          expires_at: now + ttl,
        });
        return { success: true, lockedBy: agentId };
      }
      // Different agent holds the lock
      return { success: false, lockedBy: existing.locked_by };
    }

    // No lock — acquire
    this.stmtLockUpsert.run({
      file,
      project_id: projectId,
      locked_by: agentId,
      locked_at: now,
      expires_at: now + ttl,
    });
    return { success: true, lockedBy: agentId };
  }

  releaseLock(projectId: string, file: string, agentId: string): boolean {
    const existing = this.stmtLockGet.get(file, projectId) as TeamLockRow | undefined;
    if (!existing || existing.locked_by !== agentId) return false;
    this.stmtLockDelete.run(file, projectId);
    return true;
  }

  getLockStatus(projectId: string, file: string): TeamLockRow | null {
    // Clean expired first
    this.stmtLockDeleteExpired.run(projectId, Date.now());
    const row = this.stmtLockGet.get(file, projectId) as TeamLockRow | undefined;
    return row ?? null;
  }

  listLocks(projectId: string, agentId?: string): TeamLockRow[] {
    // Clean expired first
    this.stmtLockDeleteExpired.run(projectId, Date.now());
    if (agentId) {
      return this.stmtLockListByAgent.all(projectId, agentId) as TeamLockRow[];
    }
    return this.stmtLockListByProject.all(projectId) as TeamLockRow[];
  }

  releaseAllLocks(agentId: string): number {
    const info = this.stmtLockDeleteByAgent.run(agentId);
    return info.changes;
  }

  cleanExpiredLocks(projectId: string): number {
    const info = this.stmtLockDeleteExpired.run(projectId, Date.now());
    return info.changes;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Migration from team-state.json
  // ═══════════════════════════════════════════════════════════════════

  private async migrateFromJsonIfNeeded(): Promise<void> {
    // Only migrate if team tables are empty AND team-state.json exists
    const agentCount = this.db.prepare(`SELECT COUNT(*) AS cnt FROM team_agents`).get();
    if (agentCount.cnt > 0) return;

    // Look for team-state.json in the project directory (parent of dataDir/.memorix)
    // team-state.json lives at projectRoot/team-state.json
    const candidates = [
      path.join(this.dataDir, 'team-state.json'),
      path.join(this.dataDir, '..', 'team-state.json'),
    ];

    let jsonPath: string | null = null;
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        jsonPath = p;
        break;
      }
    }
    if (!jsonPath) return;

    try {
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const snap = JSON.parse(raw);
      if (snap.version !== 1) return;

      console.error(`[memorix] Migrating team-state.json to SQLite...`);
      let agentsMigrated = 0;
      let messagesMigrated = 0;
      let tasksMigrated = 0;
      let locksMigrated = 0;

      // Disable FK enforcement during migration — legacy data may have dangling refs
      this.db.pragma('foreign_keys = OFF');
      this.db.transaction(() => {
        // Migrate agents
        if (snap.registry?.agents) {
          for (const [id, raw] of Object.entries(snap.registry.agents) as [string, any][]) {
            this.stmtAgentUpsert.run({
              agent_id: id,
              project_id: 'migrated', // Will be updated on next session_start
              agent_type: 'unknown',
              instance_id: id, // Use agent_id as instance_id for migrated agents
              name: raw.name ?? '',
              role: raw.role ?? null,
              capabilities: raw.capabilities ? JSON.stringify(raw.capabilities) : null,
              status: raw.status ?? 'inactive',
              joined_at: raw.joinedAt ? new Date(raw.joinedAt).getTime() : Date.now(),
              last_heartbeat: raw.lastSeenAt ? new Date(raw.lastSeenAt).getTime() : Date.now(),
              left_at: raw.leftAt ? new Date(raw.leftAt).getTime() : null,
              last_seen_obs_generation: 0,
            });
            agentsMigrated++;
          }
        }

        // Migrate messages
        if (snap.messages?.inboxes) {
          for (const [agentId, msgs] of Object.entries(snap.messages.inboxes) as [string, any[]][]) {
            for (const msg of msgs) {
              this.stmtMsgInsert.run({
                id: msg.id ?? randomUUID(),
                project_id: 'migrated',
                sender_agent_id: msg.from ?? 'unknown',
                recipient_agent_id: msg.to === '__broadcast__' ? null : (msg.to ?? agentId),
                type: msg.type ?? 'direct',
                content: msg.content ?? '',
                payload: null,
                task_id: null,
                read_at: msg.read ? Date.now() : null,
                created_at: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
              });
              messagesMigrated++;
            }
          }
        }

        // Migrate tasks
        if (snap.tasks?.tasks) {
          for (const [id, raw] of Object.entries(snap.tasks.tasks) as [string, any][]) {
            this.stmtTaskInsert.run({
              task_id: id,
              project_id: 'migrated',
              description: raw.description ?? '',
              status: raw.status ?? 'pending',
              assignee_agent_id: raw.assignee ?? null,
              result: raw.result ?? null,
              metadata: raw.metadata ? JSON.stringify(raw.metadata) : null,
              created_by: null,
              created_at: raw.createdAt ? new Date(raw.createdAt).getTime() : Date.now(),
              updated_at: raw.updatedAt ? new Date(raw.updatedAt).getTime() : Date.now(),
            });
            // Migrate deps
            if (Array.isArray(raw.deps)) {
              for (const dep of raw.deps) {
                this.stmtTaskDepInsert.run(id, dep);
              }
            }
            tasksMigrated++;
          }
        }

        // Migrate locks
        if (snap.locks?.locks) {
          for (const [file, raw] of Object.entries(snap.locks.locks) as [string, any][]) {
            this.stmtLockUpsert.run({
              file,
              project_id: 'migrated',
              locked_by: raw.lockedBy ?? 'unknown',
              locked_at: raw.lockedAt ? new Date(raw.lockedAt).getTime() : Date.now(),
              expires_at: raw.expiresAt ? new Date(raw.expiresAt).getTime() : Date.now(),
            });
            locksMigrated++;
          }
        }
      })();

      this.db.pragma('foreign_keys = ON');

      console.error(
        `[memorix] Team migration complete: ${agentsMigrated} agents, ${messagesMigrated} messages, ${tasksMigrated} tasks, ${locksMigrated} locks.`
      );

      // Rename the JSON file to mark migration done
      try {
        fs.renameSync(jsonPath, jsonPath + '.migrated');
      } catch { /* best-effort rename */ }

    } catch (err) {
      console.error(`[memorix] team-state.json migration failed (non-fatal): ${err}`);
    }
  }

  // ── Accessor for raw DB (used by cross-process tests) ─────────────

  getDb(): any {
    return this.db;
  }
}

// ── Singleton access ────────────────────────────────────────────────

let _teamStore: TeamStore | null = null;
let _teamStoreDataDir: string | null = null;

export function getTeamStore(): TeamStore {
  if (!_teamStore) {
    throw new Error('[memorix] TeamStore not initialized — call initTeamStore() first');
  }
  return _teamStore;
}

export function isTeamStoreInitialized(): boolean {
  return _teamStore !== null;
}

export async function initTeamStore(dataDir: string): Promise<TeamStore> {
  if (_teamStore && _teamStoreDataDir === dataDir) return _teamStore;

  _teamStore = null;
  _teamStoreDataDir = null;

  const store = new TeamStore();
  await store.init(dataDir);
  _teamStore = store;
  _teamStoreDataDir = dataDir;
  return store;
}

export function resetTeamStore(): void {
  _teamStore = null;
  _teamStoreDataDir = null;
}
