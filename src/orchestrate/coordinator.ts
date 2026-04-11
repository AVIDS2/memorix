/**
 * Coordinator — Phase 4c autonomous coordination loop.
 *
 * Drives off SQLite poll (rule D1) — NOT EventBus.
 * Reads TeamStore task board, claims available tasks, spawns agent CLIs,
 * monitors exit, handles retry/rescue, and exits when all tasks are done.
 *
 * Architectural boundary: this is a leaf module under src/orchestrate/.
 * It depends on 4a TeamStore + 4b primitives. Nothing depends on it.
 * Deleting src/orchestrate/ has zero impact on the rest of Memorix.
 */

import type { TeamStore, TeamTaskRow } from '../team/team-store.js';
import type { AgentAdapter, AgentProcess } from './adapters/types.js';
import { buildAgentPrompt, type HandoffContext } from './prompt-builder.js';

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
}

export type CoordinatorEventType =
  | 'started' | 'task:dispatched' | 'task:completed' | 'task:failed'
  | 'task:retry' | 'task:timeout' | 'agent:stale' | 'finished' | 'error';

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

  const startTime = Date.now();
  let retryCount = 0;
  let aborted = false;
  const taskAttempts = new Map<string, number>(); // taskId → attempt count
  const activeDispatches: ActiveDispatch[] = [];
  let adapterRoundRobin = 0;

  // Register orchestrator as an agent
  const orchestratorAgent = teamStore.registerAgent({
    projectId,
    agentType: 'orchestrator',
    instanceId: `orch-${Date.now()}`,
    name: 'memorix-orchestrator',
  });
  const orchAgentId = orchestratorAgent.agent_id;

  const emit = (type: CoordinatorEventType, message: string, extra?: Partial<CoordinatorEvent>) => {
    onProgress?.({ type, timestamp: Date.now(), message, ...extra });
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

        // Pick adapter (round-robin)
        const adapter = adapters[adapterRoundRobin % adapters.length];
        adapterRoundRobin++;

        // Claim task
        const claim = teamStore.claimTask(task.task_id, orchAgentId);
        if (!claim.success) continue; // another process claimed it

        // Build prompt with handoff context (best-effort — failure falls back to empty)
        let handoffs: HandoffContext[] = [];
        if (resolveHandoffs) {
          try { handoffs = await resolveHandoffs(task.task_id); } catch { /* handoff is enhancement, not critical */ }
        }
        const prompt = buildAgentPrompt({
          task,
          handoffs,
          agentId: orchAgentId,
          projectId,
          projectDir,
        });

        // Spawn agent
        const agentProcess = adapter.spawn(prompt, {
          cwd: projectDir,
          timeoutMs: taskTimeoutMs,
        });

        taskAttempts.set(task.task_id, attempts + 1);
        activeDispatches.push({
          taskId: task.task_id,
          agentProcess,
          adapterName: adapter.name,
          attempt: attempts + 1,
        });

        emit('task:dispatched', `Task "${task.description}" → ${adapter.name} (attempt ${attempts + 1})`, {
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
            emit('task:completed', `Task "${taskDesc}" completed by ${dispatch.adapterName}`, {
              taskId: dispatch.taskId,
              agentName: dispatch.adapterName,
            });
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
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
