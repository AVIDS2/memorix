/**
 * memorix orchestrate — Autonomous multi-agent coordination.
 *
 * Phase 4c: Runs a coordination loop that dispatches agents to tasks,
 * monitors progress, handles failures, and exits when all work is done.
 *
 * Drive model: SQLite poll (rule D1). NOT EventBus.
 */

import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'orchestrate',
    description: 'Run autonomous multi-agent coordination loop',
  },
  args: {
    project: {
      type: 'string',
      description: 'Project root path (default: cwd)',
      required: false,
    },
    agents: {
      type: 'string',
      description: 'Comma-separated agent names: claude,codex,gemini (default: claude)',
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
  },
  run: async ({ args }) => {
    const { detectProject } = await import('../../project/detector.js');
    const { initTeamStore } = await import('../../team/team-store.js');
    const { getProjectDataDir } = await import('../../store/persistence.js');
    const { resolveAdapters } = await import('../../orchestrate/adapters/index.js');
    const { runCoordinationLoop } = await import('../../orchestrate/coordinator.js');
    const path = await import('node:path');

    const projectDir = args.project ? path.resolve(args.project) : process.cwd();
    const proj = detectProject(projectDir);
    if (!proj) {
      console.error('❌ Not a git repository. Run `git init` first.');
      process.exit(1);
    }

    const agentNames = (args.agents as string).split(',').map(s => s.trim()).filter(Boolean);
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
    const parallel = parseInt(args.parallel as string, 10);
    const pollIntervalMs = parseInt(args.poll as string, 10);
    const dryRun = args['dry-run'] as boolean;

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

    // Check if there are tasks to work on
    const tasks = teamStore.listTasks(proj.id);
    const pendingTasks = tasks.filter(t => t.status === 'pending');
    if (tasks.length === 0) {
      console.error('📋 No tasks found. Create tasks first with `team_task create`.');
      process.exit(0);
    }

    console.error(`\n🚀 Orchestrator started for project ${proj.name}`);
    console.error(`📋 ${pendingTasks.length} pending, ${tasks.filter(t => t.status === 'in_progress').length} in progress, ${tasks.filter(t => t.status === 'completed').length} completed`);
    console.error(`🤖 Agents: ${(dryRun ? adapters : available).map(a => a.name).join(', ')}`);
    console.error(`⚙️  Parallel: ${parallel}, Retries: ${maxRetries}, Timeout: ${taskTimeoutMs}ms`);
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
      dryRun,
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
