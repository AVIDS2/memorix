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
import type { AgentAdapter, AgentProcess, AgentMessage, TokenUsage } from './adapters/types.js';
import { buildAgentPrompt, type HandoffContext } from './prompt-builder.js';
import { isPlannerTask, materializeTaskGraph, extractPipelineId } from './planner.js';
import { createLedger, appendEntry, ledgerToPromptSection, type PipelineLedger } from './ledger.js';
import { pickAdapter, extractRoleFromDescription, type RoutingConfig } from './capability-router.js';
import { initTraceTable, writeTrace, pruneOldTraces, resetTraceCache, type TraceEvent } from './pipeline-trace.js';
import { createWorktree, mergeWorktree, removeWorktree, cleanupOrphanWorktrees } from './worktree.js';
import { runVerifyGates, hasGateFailure, getFirstFailure, type GateResult, type GateConfig } from './verify-gate.js';
import { classifyError, resetBackoff, type RecoveryAction } from './error-recovery.js';
import { calculatePipelineCost, isBudgetExceeded, formatCostSummary } from './cost-tracker.js';
import { writeTaskEvidence, writePipelineSummary, type TaskEvidence } from './evidence.js';
import { TaskToolTracker } from './permission.js';
import { storeVerifiedFix, storeFixExhausted, searchKnownFixes, searchLessons, storeTaskCompletion, storePipelineSummary as memStorePipelineSummary, type BridgeConfig, DEFAULT_BRIDGE_CONFIG } from './memorix-bridge.js';

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

  // ── Phase 7: Verify Gates + Fix Loop ────────────────────────────

  /** Shell command for compile gate (e.g. 'npm run build', 'tsc --noEmit'). Skipped if unset. */
  compileCommand?: string;
  /** Shell command for test gate (e.g. 'npm test', 'npx vitest run'). Skipped if unset. */
  testCommand?: string;
  /** Max fix attempts per task before falling back to from-scratch retry (default: 3) */
  maxFixAttempts?: number;
  /** USD budget limit — abort pipeline when exceeded (no limit if unset) */
  budgetUSD?: number;
  /** Enable lesson injection from Memorix before dispatch (default: true) */
  enableLessons?: boolean;
  /** Enable lifecycle memory capture (default: false) */
  enableMemoryCapture?: boolean;
  /** Enable evidence directory writing (default: true when pipelineId set) */
  enableEvidence?: boolean;
  /** Phase 7: Verification mode — 'command' (default), 'goals', or 'both' */
  verifyMode?: 'command' | 'goals' | 'both';
}

export type CoordinatorEventType =
  | 'started' | 'task:dispatched' | 'task:completed' | 'task:failed'
  | 'task:retry' | 'task:timeout' | 'agent:stale' | 'finished' | 'error'
  | 'plan:materialized' | 'plan:failed' | 'worktree:create' | 'worktree:merge'
  | 'agent:tool_use' | 'agent:message';

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
  /** Accumulated token usage per model across all tasks */
  tokenUsage?: Record<string, TokenUsage>;
  /** Phase 7: Cost summary with USD breakdown */
  costSummary?: ReturnType<typeof calculatePipelineCost>;
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
  /** Background promise consuming stream messages (fire-and-forget) */
  messageConsumer?: Promise<void>;
  /** Tool use counter for this dispatch */
  toolCount: number;
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
  if (config.budgetUSD != null && (!Number.isFinite(config.budgetUSD) || config.budgetUSD <= 0)) {
    throw new Error(`coordinator: budgetUSD must be > 0 when set, got ${config.budgetUSD}`);
  }

  const startTime = Date.now();
  let retryCount = 0;
  let aborted = false;
  const taskAttempts = new Map<string, number>(); // taskId → attempt count
  const taskSessionIds = new Map<string, string>(); // taskId → sessionId (for retry reuse)
  const taskFixAttempts = new Map<string, number>(); // taskId → fix loop attempt count
  const taskFailedAgents = new Map<string, Set<string>>(); // taskId → agents that failed on this task
  const activeDispatches: ActiveDispatch[] = [];

  // Phase 7: Gate config (derived from coordinator config)
  const maxFixAttempts = config.maxFixAttempts ?? 3;
  const gateConfig: GateConfig = {
    compileCommand: config.compileCommand,
    testCommand: config.testCommand,
  };
  const hasGates = !!(config.compileCommand || config.testCommand);
  const useWorktrees = parallel >= 2 && !dryRun;

  // Phase 7: Bridge config, evidence tracking, tool trackers
  const bridgeConfig: BridgeConfig = {
    ...DEFAULT_BRIDGE_CONFIG,
    enableLessons: config.enableLessons ?? true,
    enableMemoryCapture: config.enableMemoryCapture ?? false,
  };
  const enableEvidence = config.enableEvidence ?? !!pipelineId;
  const taskEvidenceList: TaskEvidence[] = [];
  const taskToolTrackers = new Map<string, TaskToolTracker>();

  // Pipeline-level token usage accumulator
  const pipelineUsage: Record<string, TokenUsage> = {};

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
        const hasUsage = Object.keys(pipelineUsage).length > 0;
        const costSummary = hasUsage ? calculatePipelineCost(pipelineUsage, config.budgetUSD) : undefined;
        const result: CoordinatorResult = {
          totalTasks: allTasks.length,
          completed: completed.length,
          failed: failed.length,
          retries: retryCount,
          elapsed: Date.now() - startTime,
          aborted: false,
          tokenUsage: hasUsage ? pipelineUsage : undefined,
          costSummary,
        };

        // Phase 7: Write pipeline summary (evidence + memorix)
        if (enableEvidence && pipelineId) {
          try {
            writePipelineSummary(projectDir, {
              pipelineId, goal: '', totalTasks: allTasks.length,
              completed: completed.length, failed: failed.length,
              elapsedMs: Date.now() - startTime,
              tokenUsage: hasUsage ? pipelineUsage : undefined,
              costUSD: costSummary?.totalUSD,
              tasks: taskEvidenceList,
            });
          } catch { /* evidence is best-effort */ }
        }
        if (bridgeConfig.enableMemoryCapture && pipelineId) {
          try {
            memStorePipelineSummary({
              projectId, pipelineId, goal: '',
              totalTasks: allTasks.length, completed: completed.length,
              failed: failed.length, elapsedMs: Date.now() - startTime,
            });
          } catch { /* fire-and-forget */ }
        }

        if (costSummary) {
          emit('finished', `All tasks processed: ${completed.length} completed, ${failed.length} failed\n${formatCostSummary(costSummary)}`);
        } else {
          emit('finished', `All tasks processed: ${completed.length} completed, ${failed.length} failed`);
        }
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
          tokenUsage: Object.keys(pipelineUsage).length > 0 ? pipelineUsage : undefined,
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

        // Phase 6f: Pick adapter by role with per-type quota awareness
        const role = extractRoleFromDescription(task.description);
        const busyNames = new Set(activeDispatches.map(d => d.adapterName));
        // Build dispatch count per adapter name for quota-aware routing
        const dispatchCounts: Record<string, number> = {};
        for (const d of activeDispatches) {
          dispatchCounts[d.adapterName] = (dispatchCounts[d.adapterName] ?? 0) + 1;
        }
        const failedOnTask = taskFailedAgents.get(task.task_id);
        const adapter = pickAdapter(role, adapters, busyNames, routingConfig, dispatchCounts, failedOnTask);

        // If quotaMap is set and all adapters are at capacity, stop dispatching this cycle
        if (routingConfig?.quotaMap) {
          const quota = routingConfig.quotaMap[adapter.name] ?? 1;
          const active = dispatchCounts[adapter.name] ?? 0;
          if (active >= quota) break; // all adapters full — wait for completions
        }

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

        // Phase 7: Inject lessons from Memorix (best-effort, 3s timeout)
        let lessonContext: string | undefined;
        try {
          lessonContext = await searchLessons(task.description ?? '', projectId, bridgeConfig) || undefined;
        } catch { /* lesson injection is best-effort */ }

        // Phase 7: Extract goals from task metadata (Goal-First Testing)
        let goals: string[] | undefined;
        try {
          if (task.metadata) {
            const meta = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : task.metadata;
            if (Array.isArray(meta?.goals)) goals = meta.goals;
          }
        } catch { /* metadata parse is best-effort */ }

        const prompt = buildAgentPrompt({
          task,
          handoffs,
          agentId: orchAgentId,
          projectId,
          projectDir,
          ledgerContext,
          lessonContext,
          goals,
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

        // Spawn agent — planner tasks get larger ring buffer for full TaskGraph output
        const taskMeta = isPlannerTask(task.metadata);
        // Session reuse: on retry, pass previous sessionId so Claude can resume context
        const prevSessionId = taskSessionIds.get(task.task_id);
        const agentProcess = adapter.spawn(prompt, {
          cwd: spawnCwd,
          timeoutMs: taskTimeoutMs,
          tailLines: taskMeta ? 500 : undefined,
          resumeSessionId: attempts > 0 ? prevSessionId : undefined,
        });

        taskAttempts.set(task.task_id, attempts + 1);
        const dispatch: ActiveDispatch = {
          taskId: task.task_id,
          agentProcess,
          adapterName: adapter.name,
          attempt: attempts + 1,
          dispatchedAt: Date.now(),
          worktreePath,
          worktreeBranch,
          toolCount: 0,
        };

        // Start streaming message consumer (fire-and-forget, best-effort)
        if (agentProcess.messages) {
          dispatch.messageConsumer = (async () => {
            // Phase 7: Create tool tracker for permission monitoring
            const tracker = new TaskToolTracker(task.task_id);
            taskToolTrackers.set(task.task_id, tracker);

            try {
              for await (const msg of agentProcess.messages!) {
                if (msg.type === 'tool_use') {
                  dispatch.toolCount++;
                  // Phase 7: Record tool usage for risk profiling
                  if (msg.tool) tracker.record(msg.tool);
                  emit('agent:tool_use', `[${adapter.name}] tool #${dispatch.toolCount}: ${msg.tool ?? 'unknown'}`, {
                    taskId: task.task_id,
                    agentName: adapter.name,
                  });
                  // Write tool_use to pipeline trace
                  if (traceDb && pipelineId) {
                    try {
                      writeTrace(traceDb, {
                        pipelineId,
                        timestamp: Date.now(),
                        type: 'dispatch',
                        taskId: task.task_id,
                        agent: adapter.name,
                        detail: `tool: ${msg.tool ?? 'unknown'}`,
                      });
                    } catch { /* trace is best-effort */ }
                  }
                }
              }
            } catch { /* stream consumer is best-effort */ }
          })();
        }

        activeDispatches.push(dispatch);

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

          // Accumulate token usage into pipeline total
          if (result.tokenUsage) {
            for (const [model, usage] of Object.entries(result.tokenUsage)) {
              const prev = pipelineUsage[model] ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, model };
              prev.inputTokens += usage.inputTokens;
              prev.outputTokens += usage.outputTokens;
              prev.cacheReadTokens += usage.cacheReadTokens;
              prev.cacheWriteTokens += usage.cacheWriteTokens;
              pipelineUsage[model] = prev;
            }
            // Write usage to pipeline trace
            if (traceDb && pipelineId) {
              try {
                const usageSummary = Object.entries(result.tokenUsage)
                  .map(([m, u]) => `${m}: in=${u.inputTokens} out=${u.outputTokens} cache_r=${u.cacheReadTokens} cache_w=${u.cacheWriteTokens}`)
                  .join('; ');
                writeTrace(traceDb, {
                  pipelineId,
                  timestamp: Date.now(),
                  type: 'complete',
                  taskId: dispatch.taskId,
                  agent: dispatch.adapterName,
                  detail: `usage: ${usageSummary}; tools: ${dispatch.toolCount}`,
                  durationMs: Date.now() - dispatch.dispatchedAt,
                });
              } catch { /* trace is best-effort */ }
            }

            // Phase 7: Budget check — abort if exceeded
            if (config.budgetUSD != null && isBudgetExceeded(pipelineUsage, config.budgetUSD)) {
              emit('error', `Budget exceeded ($${config.budgetUSD}) — aborting pipeline`, {});
              aborted = true;
              // Fail/release the current settled dispatch (already spliced out of activeDispatches)
              try {
                teamStore.failTask(dispatch.taskId, orchAgentId, `Budget exceeded ($${config.budgetUSD})`);
              } catch { try { teamStore.releaseTask(dispatch.taskId, orchAgentId); } catch { /* */ } }
              // Kill all remaining active agents and fail/release their tasks
              for (const d of activeDispatches) {
                try { d.agentProcess.abort(); } catch { /* best-effort */ }
                try {
                  teamStore.failTask(d.taskId, orchAgentId, `Budget exceeded ($${config.budgetUSD})`);
                } catch { try { teamStore.releaseTask(d.taskId, orchAgentId); } catch { /* */ } }
              }
              activeDispatches.length = 0;
              break; // Exit main loop
            }
          }

          // Track sessionId for retry reuse (Claude session continuity)
          if (result.sessionId) {
            taskSessionIds.set(dispatch.taskId, result.sessionId);
          }

          // ── 方案 A: Orchestrator owns task lifecycle ──
          // Agent does NOT call team_task. Orchestrator infers outcome from exit code.
          const taskState = teamStore.getTask(dispatch.taskId);
          const taskDesc = taskState?.description ?? dispatch.taskId;

          if (!result.killed && result.exitCode === 0) {
            // ── Phase 7: Run verify gates before marking completed ──
            let gateResults: GateResult[] = [];
            let gateFailed = false;

            // Skip gates for planner/reviewer tasks — they produce plans, not code
            const taskMeta = isPlannerTask(taskState?.metadata as string | null);
            const skipGates = !!taskMeta; // planner or reviewer task

            if (hasGates && !skipGates) {
              const gateCwd = dispatch.worktreePath ?? projectDir;
              try {
                gateResults = await runVerifyGates(gateCwd, gateConfig);
                gateFailed = hasGateFailure(gateResults);
              } catch {
                // Gate runner itself crashed → degrade to no-gate behavior
                gateResults = [];
                gateFailed = false;
              }
            }

            if (gateFailed) {
              // ── Phase 7: Fix Loop — gate failed, try targeted repair ──
              const fixAttempts = taskFixAttempts.get(dispatch.taskId) ?? 0;
              const failure = getFirstFailure(gateResults)!;

              if (fixAttempts < maxFixAttempts) {
                taskFixAttempts.set(dispatch.taskId, fixAttempts + 1);

                // Build fix prompt with gate error output
                const gateOutput = failure.output.length > 4096
                  ? failure.output.slice(0, 2048) + `\n... (${failure.output.length - 4096} bytes omitted) ...\n` + failure.output.slice(-2048)
                  : failure.output;

                const fixPrompt = [
                  `## Fix Required (${failure.gate} gate failed, attempt ${fixAttempts + 1}/${maxFixAttempts})`,
                  '',
                  `The ${failure.gate} gate failed after your code changes.`,
                  `Command: \`${failure.command}\``,
                  '',
                  '### Error Output',
                  '```',
                  gateOutput,
                  '```',
                  '',
                  'Fix ONLY the errors above. Do not rewrite from scratch.',
                  'Focus on the specific compile/test errors and make minimal changes.',
                ].join('\n');

                // Re-dispatch with resumeSessionId for context continuity
                const prevSessionId = taskSessionIds.get(dispatch.taskId);
                const fixAdapter = adapters.find(a => a.name === dispatch.adapterName) ?? adapters[0];
                const fixProcess = fixAdapter.spawn(fixPrompt, {
                  cwd: dispatch.worktreePath ?? projectDir,
                  timeoutMs: taskTimeoutMs,
                  resumeSessionId: prevSessionId,
                });

                // Track the fix dispatch
                const fixDispatch: ActiveDispatch = {
                  taskId: dispatch.taskId,
                  agentProcess: fixProcess,
                  adapterName: dispatch.adapterName,
                  attempt: dispatch.attempt,
                  dispatchedAt: Date.now(),
                  worktreePath: dispatch.worktreePath,
                  worktreeBranch: dispatch.worktreeBranch,
                  toolCount: 0,
                };

                // Start streaming message consumer for fix dispatch
                if (fixProcess.messages) {
                  fixDispatch.messageConsumer = (async () => {
                    try {
                      for await (const msg of fixProcess.messages!) {
                        if (msg.type === 'tool_use') {
                          fixDispatch.toolCount++;
                        }
                      }
                    } catch { /* stream consumer is best-effort */ }
                  })();
                }

                activeDispatches.push(fixDispatch);

                emit('task:retry', `${failure.gate} gate failed for "${taskDesc}", fix attempt ${fixAttempts + 1}/${maxFixAttempts}`, {
                  taskId: dispatch.taskId,
                  agentName: dispatch.adapterName,
                });

                // Update ledger with gate failure
                if (ledger) {
                  try {
                    const role = extractRoleFromDescription(taskState?.description ?? '');
                    appendEntry(ledger, {
                      taskId: dispatch.taskId,
                      role,
                      agent: dispatch.adapterName,
                      status: 'failed',
                      summary: `${failure.gate} gate failed (fix ${fixAttempts + 1}/${maxFixAttempts}): ${failure.output.slice(0, 200)}`,
                      outputFiles: [],
                      durationMs: Date.now() - dispatch.dispatchedAt,
                      timestamp: Date.now(),
                    });
                  } catch { /* ledger is best-effort */ }
                }

                continue; // Skip to next settled dispatch — fix dispatch is now active
              } else {
                // Fix attempts exhausted → fall through to normal failure path below
                emit('task:failed', `Fix loop exhausted for "${taskDesc}" after ${fixAttempts} fix attempts (${failure.gate} gate)`, {
                  taskId: dispatch.taskId,
                  agentName: dispatch.adapterName,
                });

                // Record failed agent for fallback routing
                const failedSet = taskFailedAgents.get(dispatch.taskId) ?? new Set<string>();
                failedSet.add(dispatch.adapterName);
                taskFailedAgents.set(dispatch.taskId, failedSet);

                // Fail the task — will be retried from scratch by existing retry logic
                try {
                  teamStore.failTask(dispatch.taskId, orchAgentId,
                    `${failure.gate} gate failed after ${fixAttempts} fix attempts: ${failure.output.slice(0, 300)}`);
                } catch { /* best-effort */ }

                // Update ledger
                if (ledger) {
                  try {
                    appendEntry(ledger, {
                      taskId: dispatch.taskId,
                      role: extractRoleFromDescription(taskState?.description ?? ''),
                      agent: dispatch.adapterName,
                      status: 'failed',
                      summary: `Fix loop exhausted (${fixAttempts} attempts): ${failure.output.slice(0, 200)}`,
                      outputFiles: [],
                      durationMs: Date.now() - dispatch.dispatchedAt,
                      timestamp: Date.now(),
                    });
                  } catch { /* ledger is best-effort */ }
                }

                // Phase 7: Write evidence for fix-exhausted task
                if (enableEvidence && pipelineId) {
                  try {
                    const ev: TaskEvidence = {
                      taskId: dispatch.taskId, taskDescription: taskDesc,
                      agentName: dispatch.adapterName, status: 'failed',
                      durationMs: Date.now() - dispatch.dispatchedAt,
                      tailOutput: result.tailOutput, tokenUsage: result.tokenUsage,
                      fixAttempts,
                      gateResults,
                    };
                    writeTaskEvidence(projectDir, pipelineId, ev);
                    taskEvidenceList.push(ev);
                  } catch { /* evidence is best-effort */ }
                }

                // Worktree cleanup on fix exhaustion
                if (dispatch.worktreePath) {
                  try { removeWorktree(projectDir, dispatch.worktreePath, dispatch.worktreeBranch); } catch { /* best-effort */ }
                }

                // Check if we can retry from scratch
                const attempts = taskAttempts.get(dispatch.taskId) ?? 1;
                if (attempts <= maxRetries) {
                  taskFixAttempts.delete(dispatch.taskId); // Reset fix counter for fresh retry
                  const taskRow = teamStore.getTask(dispatch.taskId);
                  if (taskRow && taskRow.status === 'failed') {
                    teamStore.getDb().prepare(
                      'UPDATE team_tasks SET status = ?, assignee_agent_id = NULL, result = NULL, updated_at = ? WHERE task_id = ?',
                    ).run('pending', Date.now(), dispatch.taskId);
                  }
                  retryCount++;
                  emit('task:retry', `Task "${taskDesc}" fix loop exhausted, retrying from scratch (${attempts}/${maxRetries})`, {
                    taskId: dispatch.taskId,
                  });
                }

                continue; // Already handled — skip the normal completion path
              }
            }

            // ── Gates passed (or no gates configured) → mark completed ──
            try {
              teamStore.completeTask(dispatch.taskId, orchAgentId, result.tailOutput.slice(-500) || 'Completed');
            } catch { /* best-effort */ }

            // Reset fix counter and failed agents on success
            taskFixAttempts.delete(dispatch.taskId);
            taskFailedAgents.delete(dispatch.taskId);

            // Phase 6c: If this was a structured planner task, materialize the graph
            const taskRow = teamStore.getTask(dispatch.taskId);
            const plannerMeta = taskRow ? isPlannerTask(taskRow.metadata) : null;
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
                const mergeResult = mergeWorktree(projectDir, dispatch.worktreeBranch, dispatch.worktreePath);
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
            if (ledger && taskRow) {
              try {
                const role = extractRoleFromDescription(taskRow.description);
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

              // Phase 7: Store verified fix memory (if gate passed after fix attempts)
              const fixCount = taskFixAttempts.get(dispatch.taskId) ?? 0;
              if (fixCount > 0 && hasGates) {
                try {
                  storeVerifiedFix({
                    projectId, gate: 'compile', passed: true,
                    errorOutput: '', fixDescription: result.tailOutput.slice(-300),
                    fixAttempt: fixCount, maxAttempts: maxFixAttempts,
                  });
                } catch { /* fire-and-forget */ }
              }
              resetBackoff(dispatch.taskId);

              // Phase 7: Lifecycle memory capture (opt-in)
              if (bridgeConfig.enableMemoryCapture && pipelineId) {
                try {
                  storeTaskCompletion({
                    projectId, pipelineId, taskId: dispatch.taskId,
                    taskDescription: taskDesc, agentName: dispatch.adapterName,
                    durationMs: Date.now() - dispatch.dispatchedAt,
                    tailOutput: result.tailOutput.slice(-200),
                  });
                } catch { /* fire-and-forget */ }
              }

              // Phase 7: Write evidence (best-effort)
              if (enableEvidence && pipelineId) {
                try {
                  const ev: TaskEvidence = {
                    taskId: dispatch.taskId, taskDescription: taskDesc,
                    agentName: dispatch.adapterName, status: 'completed',
                    durationMs: Date.now() - dispatch.dispatchedAt,
                    tailOutput: result.tailOutput, tokenUsage: result.tokenUsage,
                    fixAttempts: fixCount,
                    gateResults: gateResults.length > 0 ? gateResults : undefined,
                  };
                  writeTaskEvidence(projectDir, pipelineId, ev);
                  taskEvidenceList.push(ev);
                } catch { /* evidence is best-effort */ }
              }
            }
          } else {
            // Agent failed or timed out → orchestrator marks task failed (may retry)
            let reason: string;
            if (result.killed) {
              reason = `Timed out after ${taskTimeoutMs}ms`;
              emit('task:timeout', reason, { taskId: dispatch.taskId, agentName: dispatch.adapterName });
            } else {
              reason = `Exit code ${result.exitCode}: ${result.tailOutput.slice(-200)}`;
              // Diagnostic: emit full tail for debugging agent failures
              emit('error', `[DIAG] ${dispatch.adapterName} exit=${result.exitCode} tail(500)=${result.tailOutput.slice(-500)}`, {
                taskId: dispatch.taskId, agentName: dispatch.adapterName,
              });
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

            // Phase 7: Error recovery classification
            const recovery = classifyError({
              exitCode: result.exitCode,
              killed: result.killed,
              tailOutput: result.tailOutput,
            }, dispatch.taskId);

            // Record failed agent for fallback routing
            const failedSet2 = taskFailedAgents.get(dispatch.taskId) ?? new Set<string>();
            failedSet2.add(dispatch.adapterName);
            taskFailedAgents.set(dispatch.taskId, failedSet2);

            // Phase 7: Write evidence for failed task
            if (enableEvidence && pipelineId) {
              try {
                const fixCount = taskFixAttempts.get(dispatch.taskId) ?? 0;
                const ev: TaskEvidence = {
                  taskId: dispatch.taskId, taskDescription: taskDesc,
                  agentName: dispatch.adapterName, status: 'failed',
                  durationMs: Date.now() - dispatch.dispatchedAt,
                  tailOutput: result.tailOutput, tokenUsage: result.tokenUsage,
                  fixAttempts: fixCount > 0 ? fixCount : undefined,
                };
                writeTaskEvidence(projectDir, pipelineId, ev);
                taskEvidenceList.push(ev);
              } catch { /* evidence is best-effort */ }
            }

            const attempts = taskAttempts.get(dispatch.taskId) ?? 1;
            if (attempts <= maxRetries) {
              // Phase 7: Apply recovery strategy delay
              if (recovery.delayMs > 0) {
                await sleep(recovery.delayMs);
              }

              // Reset to pending for retry via direct DB update
              // Clear result to avoid stale data from previous attempt leaking
              const taskRow = teamStore.getTask(dispatch.taskId);
              if (taskRow && taskRow.status === 'failed') {
                teamStore.getDb().prepare(
                  'UPDATE team_tasks SET status = ?, assignee_agent_id = NULL, result = NULL, updated_at = ? WHERE task_id = ?',
                ).run('pending', Date.now(), dispatch.taskId);
              }
              retryCount++;
              emit('task:retry', `Task "${taskDesc}" failed (${recovery.category}), retrying (${attempts}/${maxRetries})`, {
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
    const hasUsageAbort = Object.keys(pipelineUsage).length > 0;
    return {
      totalTasks: teamStore.listTasks(projectId).length,
      completed: teamStore.listTasks(projectId, { status: 'completed' }).length,
      failed: teamStore.listTasks(projectId, { status: 'failed' }).length,
      retries: retryCount,
      elapsed: Date.now() - startTime,
      aborted: true,
      tokenUsage: hasUsageAbort ? pipelineUsage : undefined,
      costSummary: hasUsageAbort ? calculatePipelineCost(pipelineUsage, config.budgetUSD) : undefined,
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
