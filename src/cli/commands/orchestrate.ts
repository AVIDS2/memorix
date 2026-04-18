/**
 * memorix orchestrate — Structured multi-agent coordination.
 *
 * Phase 6k: Runs a production-grade coordination loop with structured
 * planning, shared ledger, capability routing, pipeline tracing, and
 * optional Git worktree parallel isolation.
 *
 * Drive model: SQLite poll (rule D1). NOT EventBus.
 */

import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'orchestrate',
    description: 'Run structured multi-agent coordination loop',
  },
  args: {
    project: {
      type: 'string',
      description: 'Project root path (default: cwd)',
      required: false,
    },
    agents: {
      type: 'string',
      description: 'Agent names with optional quotas: claude:2,codex:1,gemini:2 (default: claude)',
      default: 'claude',
    },
    'max-retries': {
      type: 'string',
      description: 'Max retries per task (default: 2)',
      default: '2',
    },
    timeout: {
      type: 'string',
      description: 'Per-task timeout in ms (default: 600000)',
      default: '600000',
    },
    parallel: {
      type: 'string',
      description: 'Max parallel agents (default: 1)',
      default: '1',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Show what would be executed without spawning agents',
      default: false,
    },
    poll: {
      type: 'string',
      description: 'Poll interval in ms (default: 5000)',
      default: '5000',
    },
    'stale-ttl': {
      type: 'string',
      description: 'Stale agent TTL in ms (default: 600000 = 10 min)',
      default: '600000',
    },
    goal: {
      type: 'string',
      description: 'High-level goal for autonomous planning. Agents will decompose, execute, review, and iterate.',
      required: false,
    },
    'max-iterations': {
      type: 'string',
      description: 'Max review→fix cycles for autonomous mode (default: 3)',
      default: '3',
    },
    'task-budget': {
      type: 'string',
      description: 'Max total tasks for autonomous mode (default: 15)',
      default: '15',
    },
    routing: {
      type: 'string',
      description: 'Capability routing overrides: "pm=claude,engineer=codex"',
      required: false,
    },
    scheduling: {
      type: 'string',
      description: 'Scheduling policy: best-fit (default) or balanced (round-robin tiebreaker)',
      default: 'best-fit',
    },
    'no-structured-plan': {
      type: 'boolean',
      description: 'Disable structured JSON planning, use P5 legacy mode',
      default: false,
    },
    purge: {
      type: 'boolean',
      description: 'Clear all tasks before starting (clean slate)',
      default: false,
    },
    'global-timeout': {
      type: 'string',
      description: 'Overall pipeline timeout in ms (default: no limit)',
      required: false,
    },
    // ── Phase 7 flags ──────────────────────────────────────────────
    'compile-command': {
      type: 'string',
      description: 'Compile gate command (e.g. "npx tsc --noEmit"). Skipped if unset.',
      required: false,
    },
    'test-command': {
      type: 'string',
      description: 'Test gate command (e.g. "npx vitest run"). Skipped if unset.',
      required: false,
    },
    'max-fix': {
      type: 'string',
      description: 'Max fix attempts per task before from-scratch retry (default: 3)',
      default: '3',
    },
    budget: {
      type: 'string',
      description: 'USD budget limit — abort pipeline when exceeded (no limit if unset)',
      required: false,
    },
    'no-lessons': {
      type: 'boolean',
      description: 'Disable Memorix lesson injection before dispatch',
      default: false,
    },
    'memory-capture': {
      type: 'boolean',
      description: 'Enable lifecycle memory capture to Memorix',
      default: false,
    },
    'no-evidence': {
      type: 'boolean',
      description: 'Disable evidence directory writing',
      default: false,
    },
  },
  run: async ({ args }) => {
    const { detectProject } = await import('../../project/detector.js');
    const { initTeamStore } = await import('../../team/team-store.js');
    const { getProjectDataDir } = await import('../../store/persistence.js');
    const { resolveAdapters, parseAgentQuotas, buildQuotaMap } = await import('../../orchestrate/adapters/index.js');
    const { runCoordinationLoop } = await import('../../orchestrate/coordinator.js');
    const path = await import('node:path');

    const projectDir = args.project ? path.resolve(args.project) : process.cwd();
    const proj = detectProject(projectDir);
    if (!proj) {
      console.error('❌ Not a git repository. Run `git init` first.');
      process.exit(1);
    }

    // Parse agent quotas: "claude:2,codex:1,gemini:2" or legacy "claude,codex,gemini"
    const agentQuotas = parseAgentQuotas(args.agents as string);
    if (agentQuotas.length === 0) {
      console.error('❌ No valid agent adapters found.');
      process.exit(1);
    }
    const quotaMap = buildQuotaMap(agentQuotas);
    const agentNames = [...new Set(agentQuotas.map(q => q.name))];
    const adapters = resolveAdapters(agentNames);
    if (adapters.length === 0) {
      console.error('❌ No valid agent adapters found.');
      process.exit(1);
    }

    // Check adapter availability
    const available: typeof adapters = [];
    for (const adapter of adapters) {
      if (await adapter.available()) {
        available.push(adapter);
      } else {
        console.error(`⚠️  ${adapter.name} CLI not found on PATH — skipping`);
      }
    }

    if (available.length === 0 && !(args['dry-run'] as boolean)) {
      console.error('❌ No agent CLIs available. Install at least one: claude, codex, gemini');
      process.exit(1);
    }

    // Initialize TeamStore (own connection — rule D4)
    const dataDir = await getProjectDataDir(proj.id);
    const teamStore = await initTeamStore(dataDir);

    const maxRetries = parseInt(args['max-retries'] as string, 10);
    const taskTimeoutMs = parseInt(args.timeout as string, 10);
    // Default parallel = sum of quotas (e.g. claude:2,codex:1 → parallel 3)
    const totalQuota = Object.values(quotaMap).reduce((a, b) => a + b, 0);
    const parallelRaw = args.parallel as string;
    const parallel = parallelRaw === '1' && totalQuota > 1 ? totalQuota : parseInt(parallelRaw, 10);
    const pollIntervalMs = parseInt(args.poll as string, 10);
    const staleTtlMs = parseInt(args['stale-ttl'] as string, 10);
    const dryRun = args['dry-run'] as boolean;
    const globalTimeoutRaw = args['global-timeout'] as string | undefined;
    const globalTimeoutMs = globalTimeoutRaw ? parseInt(globalTimeoutRaw, 10) : undefined;

    // Validate numeric CLI args — fail fast with clear messages
    if (!Number.isFinite(parallel) || parallel < 1) {
      console.error(`❌ --parallel must be a positive integer, got: ${args.parallel}`);
      process.exit(1);
    }
    if (!Number.isFinite(taskTimeoutMs) || taskTimeoutMs <= 0) {
      console.error(`❌ --timeout must be a positive integer (ms), got: ${args.timeout}`);
      process.exit(1);
    }
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
      console.error(`❌ --poll must be a non-negative integer (ms), got: ${args.poll}`);
      process.exit(1);
    }
    if (!Number.isFinite(maxRetries) || maxRetries < 0) {
      console.error(`❌ --max-retries must be a non-negative integer, got: ${args['max-retries']}`);
      process.exit(1);
    }
    if (globalTimeoutMs != null && (!Number.isFinite(globalTimeoutMs) || globalTimeoutMs <= 0)) {
      console.error(`❌ --global-timeout must be a positive integer (ms), got: ${globalTimeoutRaw}`);
      process.exit(1);
    }

    // Phase 6k: Purge tasks before starting (D2 debt fix)
    const purge = args.purge as boolean;
    if (purge) {
      const existing = teamStore.listTasks(proj.id);
      if (existing.length > 0) {
        for (const task of existing) {
          try {
            teamStore.getDb().prepare(
              'DELETE FROM team_tasks WHERE task_id = ?',
            ).run(task.task_id);
          } catch { /* best-effort */ }
        }
        console.error(`🧹 Purged ${existing.length} existing task(s)`);
      }
    }

    // Phase 6f: Parse routing overrides + inject quota map + scheduling policy
    const { parseRoutingOverrides } = await import('../../orchestrate/capability-router.js');
    const routingOverrides = args.routing
      ? parseRoutingOverrides(args.routing as string)
      : undefined;
    const schedulingPolicy = (args.scheduling as string) === 'balanced' ? 'balanced' as const : 'best-fit' as const;
    const routingConfig = (routingOverrides || Object.keys(quotaMap).length > 0 || schedulingPolicy === 'balanced')
      ? { overrides: routingOverrides, quotaMap, scheduling: schedulingPolicy }
      : undefined;

    const structuredPlan = !(args['no-structured-plan'] as boolean);

    // ── Autonomous mode: seed planning task from --goal ──────────
    const goal = args.goal as string | undefined;
    let currentPipelineId: string | undefined;

    if (goal) {
      const maxIterations = parseInt(args['max-iterations'] as string, 10);
      const taskBudget = parseInt(args['task-budget'] as string, 10);

      if (!Number.isFinite(maxIterations) || maxIterations < 1) {
        console.error(`❌ --max-iterations must be a positive integer, got: ${args['max-iterations']}`);
        process.exit(1);
      }
      if (!Number.isFinite(taskBudget) || taskBudget < 2) {
        console.error(`❌ --task-budget must be >= 2, got: ${args['task-budget']}`);
        process.exit(1);
      }

      if (dryRun) {
        console.error(`\n🧠 Autonomous mode (DRY RUN): goal → "${goal}"`);
        console.error(`📝 Would seed planning task (not written to task board)`);
        console.error(`🔄 Max iterations: ${maxIterations}, Task budget: ${taskBudget}`);
        console.error(`📦 Structured plan: ${structuredPlan ? 'yes' : 'no (legacy)'}`);
      } else {
        const { seedAutonomousPipeline } = await import('../../orchestrate/planner.js');
        const { planningTaskId, pipelineId } = seedAutonomousPipeline(teamStore, proj.id, {
          goal,
          maxIterations,
          taskBudget,
        }, {
          structuredPlan,
          projectDir,
          agents: agentNames,
        });
        currentPipelineId = pipelineId;
        console.error(`\n🧠 Autonomous mode: goal → "${goal}"`);
        console.error(`📝 Planning task seeded: ${planningTaskId.slice(0, 8)}… (pipeline ${pipelineId.slice(0, 8)}…)`);
        console.error(`🔄 Max iterations: ${maxIterations}, Task budget: ${taskBudget}`);
        console.error(`📦 Structured plan: ${structuredPlan ? 'yes' : 'no (legacy)'}`);
      }
    }

    // Check if there are tasks to work on
    const tasks = teamStore.listTasks(proj.id);
    const pendingTasks = tasks.filter(t => t.status === 'pending');
    if (tasks.length === 0) {
      console.error('📋 No tasks found. Use --goal or create tasks with `team_task create`.');
      process.exit(0);
    }

    console.error(`\n🚀 Orchestrator started for project ${proj.name}`);
    console.error(`📋 ${pendingTasks.length} pending, ${tasks.filter(t => t.status === 'in_progress').length} in progress, ${tasks.filter(t => t.status === 'completed').length} completed`);
    const agentLabel = agentQuotas.map(q => q.quota > 1 ? `${q.name}×${q.quota}` : q.name).join(', ');
    console.error(`🤖 Agents: ${agentLabel}`);
    console.error(`⚙️  Parallel: ${parallel}, Retries: ${maxRetries}, Timeout: ${taskTimeoutMs}ms${globalTimeoutMs ? `, Global: ${globalTimeoutMs}ms` : ''}`);
    if (args.routing) console.error(`🛣️  Routing: ${args.routing}`);
    if (parallel >= 2) console.error(`🌳 Git worktree isolation: enabled`);

    // Phase 7 config display
    const compileCommand = args['compile-command'] as string | undefined;
    const testCommand = args['test-command'] as string | undefined;
    const maxFixAttempts = parseInt(args['max-fix'] as string, 10);
    const budgetRaw = args.budget as string | undefined;
    const budgetUSD = budgetRaw ? parseFloat(budgetRaw) : undefined;
    if (budgetUSD != null && (!Number.isFinite(budgetUSD) || budgetUSD <= 0)) {
      console.error(`❌ Invalid --budget value: "${budgetRaw}" (must be a positive number)`);
      process.exit(1);
    }
    const enableLessons = !(args['no-lessons'] as boolean);
    const enableMemoryCapture = args['memory-capture'] as boolean;
    const enableEvidence = !(args['no-evidence'] as boolean);

    if (compileCommand) console.error(`🔨 Compile gate: ${compileCommand}`);
    if (testCommand) console.error(`🧪 Test gate: ${testCommand}`);
    if (compileCommand || testCommand) console.error(`🔧 Max fix attempts: ${maxFixAttempts}`);
    if (budgetUSD != null) console.error(`💵 Budget: $${budgetUSD}`);
    if (!enableLessons) console.error(`📚 Lessons: disabled`);
    if (enableMemoryCapture) console.error(`🧠 Memory capture: enabled`);
    if (!enableEvidence) console.error(`📁 Evidence: disabled`);

    if (dryRun) console.error('🔍 DRY RUN — no agents will be spawned\n');
    else console.error('');

    const result = await runCoordinationLoop({
      projectDir,
      projectId: proj.id,
      adapters: dryRun ? adapters : available,
      teamStore,
      maxRetries,
      pollIntervalMs,
      taskTimeoutMs,
      parallel,
      staleTtlMs,
      dryRun,
      routingConfig,
      pipelineId: currentPipelineId,
      structuredPlan,
      globalTimeoutMs,
      compileCommand,
      testCommand,
      maxFixAttempts,
      budgetUSD,
      enableLessons,
      enableMemoryCapture,
      enableEvidence,
      onProgress: (event) => {
        const ts = new Date(event.timestamp).toLocaleTimeString();
        const icons: Record<string, string> = {
          'started': '🚀',
          'task:dispatched': '🔵',
          'task:completed': '✅',
          'task:failed': '❌',
          'task:retry': '🔄',
          'task:timeout': '⏰',
          'agent:stale': '💀',
          'finished': '🎉',
          'error': '⚠️',
          'plan:materialized': '📋',
          'plan:failed': '🚨',
          'worktree:create': '🌳',
          'worktree:merge': '🔀',
          'agent:tool_use': '🔧',
          'agent:message': '💬',
        };
        console.error(`[${ts}] ${icons[event.type] ?? '•'} ${event.message}`);
      },
    });

    console.error(`\n${'═'.repeat(60)}`);
    if (result.aborted) {
      console.error('⚠️  Orchestration aborted');
    } else if (result.failed === 0) {
      console.error(`🎉 All ${result.completed}/${result.totalTasks} tasks completed in ${formatDuration(result.elapsed)}`);
    } else {
      console.error(`📊 ${result.completed} completed, ${result.failed} failed out of ${result.totalTasks} tasks`);
    }
    if (result.retries > 0) console.error(`🔄 ${result.retries} retries`);
    console.error(`⏱️  Total time: ${formatDuration(result.elapsed)}`);

    // Token usage summary
    if (result.tokenUsage) {
      console.error(`\n💰 Token Usage:`);
      for (const [model, usage] of Object.entries(result.tokenUsage)) {
        const total = usage.inputTokens + usage.outputTokens;
        const cacheHits = usage.cacheReadTokens;
        console.error(`   ${model}: ${total.toLocaleString()} tokens (in: ${usage.inputTokens.toLocaleString()}, out: ${usage.outputTokens.toLocaleString()}${cacheHits > 0 ? `, cache: ${cacheHits.toLocaleString()}` : ''})`);
      }
    }

    // Phase 7: Cost summary
    if (result.costSummary) {
      const { formatCostSummary } = await import('../../orchestrate/cost-tracker.js');
      console.error(`\n${formatCostSummary(result.costSummary)}`);
    }

    process.exit(result.failed > 0 ? 1 : 0);
  },
});

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}
