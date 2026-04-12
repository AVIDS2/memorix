/**
 * Coordinator — Phase 6j: Production-grade coordination loop.
 *
 * Drives off SQLite poll (rule D1) — NOT EventBus.
 * Phase 6 additions:
 *   - Structured plan materialization (6c)
 *   - Shared ledger tracking (6d) + prompt injection (6e)
 *   - Capability-based agent routing (6f)
 *   - Pipeline tracing (6g)
 *   - Git worktree parallel isolation (6i)
 */

import type { TeamStore, TeamTaskRow } from '../team/team-store.js';
import type { AgentAdapter, AgentProcess } from './adapters/types.js';
import { buildAgentPrompt, type HandoffContext } from './prompt-builder.js';
import { isPlannerTask, materializeTaskGraph, extractPipelineId } from './planner.js';
import { createLedger, appendEntry, ledgerToPromptSection, type PipelineLedger } from './ledger.js';
import { pickAdapter, extractRoleFromDescription, type RoutingConfig } from './capability-router.js';
import { initTraceTable, writeTrace, pruneOldTraces, resetTraceCache, type TraceEvent } from './pipeline-trace.js';
import { createWorktree, mergeWorktree, removeWorktree, cleanupOrphanWorktrees } from './worktree.js';

// ── Types ──────────────────────────────────────────────────────────

export interface CoordinatorConfig {
  projectDir: string;
  projectId: string;
  adapters: AgentAdapter[];
  teamStore: TeamStore;
  /** Max retries per task (default: 2) */
  maxRetries?: number;
  /** SQLite poll interval in ms (default: 5_000) */
  pollIntervalMs?: number;
  /** Per-task timeout in ms (default: 600_000 = 10 min) */
  taskTimeoutMs?: number;
  /** Max parallel agent sessions (default: 1) */
  parallel?: number;
  /** Stale agent TTL in ms (default: 300_000 = 5 min) */
  staleTtlMs?: number;
  /** Dry run — show plan without spawning (default: false) */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (event: CoordinatorEvent) => void;
  /** Optional: resolve handoff context for a task. Injected to avoid coupling to observation layer. */
  resolveHandoffs?: (taskId: string) => Promise<HandoffContext[]>;
  /** Phase 6f: Capability routing overrides */
  routingConfig?: RoutingConfig;
  /** Phase 6c: Pipeline ID for structured plan materialization */
  pipelineId?: string;
  /** Phase 6c: Use structured plan (default: true) */
  structuredPlan?: boolean;
  /** Global pipeline timeout in ms. When reached, abort all active agents and stop. */
  globalTimeoutMs?: number;
}

export type CoordinatorEventType =
  | 'started' | 'task:dispatched' | 'task:completed' | 'task:failed'
  | 'task:retry' | 'task:timeout' | 'agent:stale' | 'finished' | 'error'
  | 'plan:materialized' | 'plan:failed' | 'worktree:create' | 'worktree:merge';

export interface CoordinatorEvent {
  type: CoordinatorEventType;
  timestamp: number;
  taskId?: string;
  agentName?: string;
  message: string;
}

export interface CoordinatorResult {
  totalTasks: number;
  completed: number;
  failed: number;
  retries: number;
  elapsed: number;
  aborted: boolean;
}

// ── Internal tracking ──────────────────────────────────────────────

interface ActiveDispatch {
  taskId: string;
  agentProcess: AgentProcess;
  adapterName: string;
  attempt: number;
  dispatchedAt: number;
  worktreePath?: string;
  worktreeBranch?: string;
}

// ── Main coordination loop ─────────────────────────────────────────

export async function runCoordinationLoop(config: CoordinatorConfig): Promise<CoordinatorResult> {
  const {
    projectDir,
    projectId,
    adapters,
    teamStore,
    maxRetries = 2,
    pollIntervalMs = 5_000,
    taskTimeoutMs = 600_000,
    parallel = 1,
    staleTtlMs = 300_000,
    dryRun = false,
    onProgress,
    resolveHandoffs,
    routingConfig,
    pipelineId,
    structuredPlan = true,
    globalTimeoutMs,
  } = config;

  // ── Defensive validation (guards npm import path too) ──────────
  if (!adapters || adapters.length === 0) {
    throw new Error('coordinator: adapters must be a non-empty array');
  }
  if (!Number.isFinite(parallel) || parallel < 1) {
    throw new Error(`coordinator: parallel must be >= 1, got ${parallel}`);
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
    throw new Error(`coordinator: pollIntervalMs must be >= 0, got ${pollIntervalMs}`);
  }
  if (!Number.isFinite(taskTimeoutMs) || taskTimeoutMs <= 0) {
    throw new Error(`coordinator: taskTimeoutMs must be > 0, got ${taskTimeoutMs}`);
  }
  if (!Number.isFinite(maxRetries) || maxRetries < 0) {
    throw new Error(`coordinator: maxRetries must be >= 0, got ${maxRetries}`);
  }
  if (globalTimeoutMs != null && (!Number.isFinite(globalTimeoutMs) || globalTimeoutMs <= 0)) {
    throw new Error(`coordinator: globalTimeoutMs must be > 0 when set, got ${globalTimeoutMs}`);
  }

  const startTime = Date.now();
  let retryCount = 0;
  let aborted = false;
  const taskAttempts = new Map<string, number>(); // taskId → attempt count
  const activeDispatches: ActiveDispatch[] = [];
  const useWorktrees = parallel >= 2 && !dryRun;

  // Phase 6d: Pipeline ledger (lazy-initialized after planning task completes)
  let ledger: PipelineLedger | null = null;

  // Phase 6g: Pipeline tracing
  let traceDb: ReturnType<typeof teamStore.getDb> | null = null;
  try {
    traceDb = teamStore.getDb();
    resetTraceCache();
    initTraceTable(traceDb);
  } catch { /* best-effort: tracing is non-critical */ }

  // Phase 6i: Cleanup orphan worktrees from previous crashed runs
  if (useWorktrees) {
    try {
      const cleaned = cleanupOrphanWorktrees(projectDir, (shortId) => {
        const allTasks = teamStore.listTasks(projectId);
        const match = allTasks.find(t => t.task_id.startsWith(shortId));
        return !match || match.status === 'completed' || match.status === 'failed';
      });
      if (cleaned > 0) {
        onProgress?.({
          type: 'started',
          timestamp: Date.now(),
          message: `Cleaned up ${cleaned} orphaned worktree(s)`,
        });
      }
    } catch { /* best-effort */ }
  }

  // Register orchestrator as an agent
  const orchestratorAgent = teamStore.registerAgent({
    projectId,
    agentType: 'orchestrator',
    instanceId: `orch-${Date.now()}`,
    name: 'memorix-orchestrator',
  });
  const orchAgentId = orchestratorAgent.agent_id;

  const emit = (type: CoordinatorEventType, message: string, extra?: Partial<CoordinatorEvent>) => {
    const ts = Date.now();
    onProgress?.({ type, timestamp: ts, message, ...extra });
    // Phase 6g: Write trace event
    if (traceDb && pipelineId) {
      try {
        writeTrace(traceDb, {
          pipelineId,
          timestamp: ts,
          type: type as any,
          taskId: extra?.taskId,
          agent: extra?.agentName,
          detail: message,
        });
      } catch { /* tracing is best-effort */ }
    }
  };

  emit('started', `Orchestrator started for project ${projectId}`);

  // Ctrl+C handler: abort all active processes, release tasks
  const cleanup = () => {
    aborted = true;
    for (const d of activeDispatches) {
      d.agentProcess.abort();
      try { teamStore.releaseTask(d.taskId, orchAgentId); } catch { /* best-effort */ }
    }
    activeDispatches.length = 0;
    try { teamStore.leaveAgent(orchAgentId); } catch { /* best-effort */ }
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    // ── Main loop (SQLite poll driven — rule D1) ─────────────────
    while (!aborted) {
      // Global timeout check: abort everything if wall-clock exceeded
      if (globalTimeoutMs != null && (Date.now() - startTime) >= globalTimeoutMs) {
        emit('error', `Global timeout reached (${globalTimeoutMs}ms). Aborting all active agents.`);
        for (const d of activeDispatches) {
          d.agentProcess.abort();
          try {
            teamStore.failTask(d.taskId, orchAgentId, `Global timeout after ${globalTimeoutMs}ms`);
          } catch { try { teamStore.releaseTask(d.taskId, orchAgentId); } catch { /* */ } }
        }
        activeDispatches.length = 0;
        aborted = true;
        break;
      }

      // Heartbeat orchestrator BEFORE stale detection — prevents self-stale
      try { teamStore.heartbeat(orchAgentId); } catch { /* best-effort */ }

      // Stale detection (runs after heartbeat, so orchestrator is never stale)
      try {
        const staleIds = teamStore.detectAndMarkStale(projectId, staleTtlMs);
        if (staleIds.length > 0) {
          emit('agent:stale', `Detected ${staleIds.length} stale agent(s), tasks released`);
        }
      } catch { /* best-effort */ }

      // Remove completed dispatches
      for (let i = activeDispatches.length - 1; i >= 0; i--) {
        // Non-blocking check — we'll await in the parallel section
      }

      // ── Detect & fail stranded tasks (pending with failed deps) ──
      // A task is stranded if it's pending and has at least one dep whose status is 'failed'.
      // Without this, the coordinator would spin forever trying to claim unclaimable tasks.
      try {
        const stranded = teamStore.getDb().prepare(`
          SELECT DISTINCT t.task_id, t.description FROM team_tasks t
            JOIN team_task_deps d ON t.task_id = d.task_id
            JOIN team_tasks dep ON d.dep_task_id = dep.task_id
          WHERE t.project_id = ? AND t.status = 'pending' AND dep.status = 'failed'
        `).all(projectId) as { task_id: string; description: string }[];

        for (const s of stranded) {
          teamStore.getDb().prepare(
            'UPDATE team_tasks SET status = ?, result = ?, updated_at = ? WHERE task_id = ? AND status = ?',
          ).run('failed', 'Blocked: upstream dependency failed', Date.now(), s.task_id, 'pending');
          emit('task:failed', `Task "${s.description}" blocked by failed dependency`, { taskId: s.task_id });
        }
      } catch { /* best-effort */ }

      // Get task board snapshot
      const allTasks = teamStore.listTasks(projectId);
      const available = teamStore.listTasks(projectId, { available: true });
      const completed = allTasks.filter(t => t.status === 'completed');
      const failed = allTasks.filter(t => t.status === 'failed');
      const inProgress = allTasks.filter(t => t.status === 'in_progress');

      // Exit condition: no available, no in_progress, no active dispatches
      if (available.length === 0 && inProgress.length === 0 && activeDispatches.length === 0) {
        const result: CoordinatorResult = {
          totalTasks: allTasks.length,
          completed: completed.length,
          failed: failed.length,
          retries: retryCount,
          elapsed: Date.now() - startTime,
          aborted: false,
        };
        emit('finished', `All tasks processed: ${completed.length} completed, ${failed.length} failed`);
        return result;
      }

      // Dry run: just show what would happen
      if (dryRun) {
        emit('finished', `[dry-run] Would dispatch ${available.length} available task(s) across ${adapters.length} adapter(s)`);
        return {
          totalTasks: allTasks.length,
          completed: completed.length,
          failed: failed.length,
          retries: 0,
          elapsed: Date.now() - startTime,
          aborted: false,
        };
      }

      // Dispatch available tasks up to parallel limit
      while (available.length > 0 && activeDispatches.length < parallel && !aborted) {
        const task = available.shift()!;
        const attempts = taskAttempts.get(task.task_id) ?? 0;

        // Skip tasks that exceeded max retries
        if (attempts >= maxRetries + 1) {
          continue;
        }

        // Phase 6f: Pick adapter by role (instead of round-robin)
        const role = extractRoleFromDescription(task.description);
        const busyNames = new Set(activeDispatches.map(d => d.adapterName));
        const adapter = pickAdapter(role, adapters, busyNames, routingConfig);

        // Claim task
        const claim = teamStore.claimTask(task.task_id, orchAgentId);
        if (!claim.success) continue; // another process claimed it

        // Build prompt with handoff context (best-effort — failure falls back to empty)
        let handoffs: HandoffContext[] = [];
        if (resolveHandoffs) {
          try { handoffs = await resolveHandoffs(task.task_id); } catch { /* handoff is enhancement, not critical */ }
        }

        // Phase 6d: Inject ledger context
        const ledgerContext = ledger
          ? ledgerToPromptSection(ledger, {
              taskIndex: ledger.entries.length,
            })
          : undefined;

        const prompt = buildAgentPrompt({
          task,
          handoffs,
          agentId: orchAgentId,
          projectId,
          projectDir,
          ledgerContext,
        });

        // Phase 6i: Create worktree for parallel mode
        let worktreePath: string | undefined;
        let worktreeBranch: string | undefined;
        let spawnCwd = projectDir;

        if (useWorktrees && pipelineId) {
          try {
            const wt = createWorktree(projectDir, task.task_id, pipelineId);
            worktreePath = wt.worktreePath;
            worktreeBranch = wt.branch;
            spawnCwd = wt.worktreePath;
            emit('worktree:create', `Created worktree for task ${task.task_id.slice(0, 8)}`, {
              taskId: task.task_id,
            });
          } catch (e) {
            // Worktree creation failed — fall back to shared directory
            emit('error', `Worktree creation failed, using shared dir: ${(e as Error).message}`, {
              taskId: task.task_id,
            });
          }
        }

        // Spawn agent
        const agentProcess = adapter.spawn(prompt, {
          cwd: spawnCwd,
          timeoutMs: taskTimeoutMs,
        });

        taskAttempts.set(task.task_id, attempts + 1);
        activeDispatches.push({
          taskId: task.task_id,
          agentProcess,
          adapterName: adapter.name,
          attempt: attempts + 1,
          dispatchedAt: Date.now(),
          worktreePath,
          worktreeBranch,
        });

        emit('task:dispatched', `Task "${task.description}" → ${adapter.name} [${role}] (attempt ${attempts + 1})`, {
          taskId: task.task_id,
          agentName: adapter.name,
        });
      }

      // Wait for any active dispatch to complete (or poll timeout)
      if (activeDispatches.length > 0) {
        const settled = await Promise.race([
          ...activeDispatches.map(async (d, idx) => {
            const result = await d.agentProcess.completion;
            return { idx, dispatch: d, result };
          }),
          sleep(pollIntervalMs).then(() => null), // poll timeout
        ]);

        if (settled) {
          // Remove from active
          activeDispatches.splice(settled.idx, 1);
          const { dispatch, result } = settled;

          // ── 方案 A: Orchestrator owns task lifecycle ──
          // Agent does NOT call team_task. Orchestrator infers outcome from exit code.
          const taskState = teamStore.getTask(dispatch.taskId);
          const taskDesc = taskState?.description ?? dispatch.taskId;

          if (!result.killed && result.exitCode === 0) {
            // Agent exited 0 → orchestrator marks task completed
            try {
              teamStore.completeTask(dispatch.taskId, orchAgentId, result.tailOutput.slice(-500) || 'Completed');
            } catch { /* best-effort */ }

            // Phase 6c: If this was a structured planner task, materialize the graph
            const taskMeta = teamStore.getTask(dispatch.taskId);
            const plannerMeta = taskMeta ? isPlannerTask(taskMeta.metadata) : null;
            if (plannerMeta?.plannerType === 'plan' && structuredPlan && pipelineId) {
              const matResult = materializeTaskGraph(
                teamStore,
                projectId,
                pipelineId,
                result.tailOutput,
                {
                  maxIterations: plannerMeta.maxIterations,
                  taskBudget: plannerMeta.taskBudget,
                  goal: plannerMeta.goal,
                },
              );
              if (matResult.success) {
                emit('plan:materialized', `Materialized ${matResult.taskIds.length} tasks from plan`, {
                  taskId: dispatch.taskId,
                });
                // Initialize ledger now that we know the plan
                ledger = createLedger(
                  pipelineId,
                  plannerMeta.goal,
                  matResult.graph?.summary ?? '',
                  matResult.taskIds.length,
                );
                if (matResult.warnings.length > 0) {
                  emit('error', `Plan warnings: ${matResult.warnings.join('; ')}`, {
                    taskId: dispatch.taskId,
                  });
                }
              } else {
                // Materialization failed → revert planning task to failed so
                // the run cannot be mistakenly reported as success.
                try {
                  teamStore.getDb().prepare(
                    'UPDATE team_tasks SET status = ?, result = ?, updated_at = ? WHERE task_id = ?',
                  ).run('failed', `Plan materialization failed: ${matResult.error}`, Date.now(), dispatch.taskId);
                } catch { /* best-effort */ }
                emit('plan:failed', `Failed to materialize plan: ${matResult.error}`, {
                  taskId: dispatch.taskId,
                });
              }
            }

            // Phase 6i: Merge worktree back — BEFORE ledger/event, because
            // merge conflict must downgrade the task from completed → failed.
            let mergeConflict = false;
            if (dispatch.worktreePath && dispatch.worktreeBranch) {
              try {
                const mergeResult = mergeWorktree(projectDir, dispatch.worktreeBranch);
                if (mergeResult.success) {
                  emit('worktree:merge', `Merged worktree ${dispatch.worktreeBranch}`, {
                    taskId: dispatch.taskId,
                  });
                  // Success → safe to clean up worktree and branch
                  try { removeWorktree(projectDir, dispatch.worktreePath, dispatch.worktreeBranch); } catch { /* best-effort */ }
                } else {
                  mergeConflict = true;
                  // Revert task to failed — merge conflict means work did not integrate
                  try {
                    teamStore.getDb().prepare(
                      'UPDATE team_tasks SET status = ?, result = ?, updated_at = ? WHERE task_id = ?',
                    ).run('failed', `Merge conflict — manual recovery required. Worktree preserved at ${dispatch.worktreePath}. Conflicts: ${mergeResult.conflicts?.slice(0, 200)}`, Date.now(), dispatch.taskId);
                  } catch { /* best-effort */ }
                  // Conflict → PRESERVE worktree+branch for manual recovery
                  emit('task:failed', `Worktree merge conflict for "${taskDesc}" — preserving ${dispatch.worktreePath} for manual recovery`, {
                    taskId: dispatch.taskId,
                    agentName: dispatch.adapterName,
                  });
                }
              } catch { /* best-effort */ }
            }

            // Phase 6d: Update ledger (status reflects merge outcome)
            if (ledger && taskMeta) {
              try {
                const role = extractRoleFromDescription(taskMeta.description);
                appendEntry(ledger, {
                  taskId: dispatch.taskId,
                  role,
                  agent: dispatch.adapterName,
                  status: mergeConflict ? 'failed' : 'completed',
                  summary: mergeConflict
                    ? `Merge conflict — manual recovery required at ${dispatch.worktreePath}`
                    : (result.tailOutput.slice(-200) || 'Completed'),
                  outputFiles: [],
                  durationMs: Date.now() - dispatch.dispatchedAt,
                  timestamp: Date.now(),
                });
              } catch { /* ledger is best-effort */ }
            }

            if (!mergeConflict) {
              emit('task:completed', `Task "${taskDesc}" completed by ${dispatch.adapterName}`, {
                taskId: dispatch.taskId,
                agentName: dispatch.adapterName,
              });
            }
          } else {
            // Agent failed or timed out → orchestrator marks task failed (may retry)
            let reason: string;
            if (result.killed) {
              reason = `Timed out after ${taskTimeoutMs}ms`;
              emit('task:timeout', reason, { taskId: dispatch.taskId, agentName: dispatch.adapterName });
            } else {
              reason = `Exit code ${result.exitCode}: ${result.tailOutput.slice(-200)}`;
            }

            // Fail the task (orchestrator is the assignee)
            try {
              teamStore.failTask(dispatch.taskId, orchAgentId, reason);
            } catch { /* may already be in a different state */ }

            // Phase 6d: Update ledger on failure
            if (ledger) {
              try {
                const taskMeta2 = teamStore.getTask(dispatch.taskId);
                appendEntry(ledger, {
                  taskId: dispatch.taskId,
                  role: taskMeta2 ? extractRoleFromDescription(taskMeta2.description) : 'unknown',
                  agent: dispatch.adapterName,
                  status: 'failed',
                  summary: reason.slice(0, 200),
                  outputFiles: [],
                  durationMs: Date.now() - dispatch.dispatchedAt,
                  timestamp: Date.now(),
                });
              } catch { /* ledger is best-effort */ }
            }

            // Phase 6i: Remove worktree without merge on failure
            if (dispatch.worktreePath) {
              try { removeWorktree(projectDir, dispatch.worktreePath, dispatch.worktreeBranch); } catch { /* best-effort */ }
            }

            const attempts = taskAttempts.get(dispatch.taskId) ?? 1;
            if (attempts <= maxRetries) {
              // Reset to pending for retry via direct DB update
              // Clear result to avoid stale data from previous attempt leaking
              const taskRow = teamStore.getTask(dispatch.taskId);
              if (taskRow && taskRow.status === 'failed') {
                teamStore.getDb().prepare(
                  'UPDATE team_tasks SET status = ?, assignee_agent_id = NULL, result = NULL, updated_at = ? WHERE task_id = ?',
                ).run('pending', Date.now(), dispatch.taskId);
              }
              retryCount++;
              emit('task:retry', `Task "${taskDesc}" failed, retrying (${attempts}/${maxRetries})`, {
                taskId: dispatch.taskId,
              });
            } else {
              emit('task:failed', `Task "${taskDesc}" failed after ${attempts} attempt(s): ${reason}`, {
                taskId: dispatch.taskId,
                agentName: dispatch.adapterName,
              });
            }
          }
        }
      } else {
        // Nothing to dispatch, nothing active — wait for state change
        await sleep(pollIntervalMs);
      }
    }

    // Aborted
    return {
      totalTasks: teamStore.listTasks(projectId).length,
      completed: teamStore.listTasks(projectId, { status: 'completed' }).length,
      failed: teamStore.listTasks(projectId, { status: 'failed' }).length,
      retries: retryCount,
      elapsed: Date.now() - startTime,
      aborted: true,
    };
  } finally {
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
    try { teamStore.leaveAgent(orchAgentId); } catch { /* best-effort */ }
    // Phase 6g: Prune old traces
    if (traceDb) {
      try { pruneOldTraces(traceDb, 20); } catch { /* best-effort */ }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
