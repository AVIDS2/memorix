/**
 * Memorix CLI
 *
 * Command-line interface for Memorix management.
 * Built with: citty (1.1K stars, zero-deps) + @clack/prompts (7.4K stars)
 *
 * Commands:
 *   memorix         — Enter memcode TUI (native coding agent)
 *   memorix memcode — Enter memcode TUI (explicit)
 *   memorix ask "q" — Single-shot chat question (pipe: echo "q" | memorix ask)
 *   memorix serve   — Start MCP Server on stdio
 *   memorix status  — Show project info + rules sync status
 *   memorix sync    — Interactive cross-agent rule sync
 */

import { defineCommand, runMain } from 'citty';
import * as p from '@clack/prompts';
import { getCliVersion } from './version.js';
import { importBundledMemcode } from './memcode-bootstrap.js';
import { installCliPipeErrorGuard } from './pipe-errors.js';
import { normalizeCliInvocation } from './invocation.js';
import { printCliGuideForHelp, renderCliGuide } from './command-guide.js';

installCliPipeErrorGuard();

const NO_GIT_MSG = 'Memorix requires a git repo to establish project identity. Run `git init` in this workspace first.';

/**
 * Set PI_PACKAGE_DIR so bundled memcode can find its theme files.
 * When tsup bundles memcode into the CLI, __dirname points to dist/cli/,
 * not packages/memcode/. This env var tells config.ts where to look.
 *
 * In dev: resolves to packages/memcode/
 * In global npm install: packages/memcode/ won't exist; theme files
 *   should be copied to dist/memcode/ by the build (see tsup onSuccess).
 */
function ensureMemcodePackageDir(): void {
  if (process.env.MEMCODE_PACKAGE_DIR) return;
  // Walk up from __dirname (dist/cli/) to find packages/memcode/package.json
  const path = require('node:path') as typeof import('node:path');
  const fs = require('node:fs') as typeof import('node:fs');
  let dir: string = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'packages', 'memcode');
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      process.env.MEMCODE_PACKAGE_DIR = candidate;
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';

async function runAsk(question: string): Promise<void> {
  // Use a smooth dots-style spinner (same frames as TUI ink-spinner "dots")
  // instead of @clack's ASCII spinner which flickers in non-Ink terminals.
  const dotsFrames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let frameIdx = 0;
  let interval: ReturnType<typeof setInterval> | null = null;

  const startSmoothSpinner = (msg: string) => {
    if (process.stdout.isTTY) {
      process.stdout.write(`${CYAN}${dotsFrames[0]}${RESET} ${msg}`);
      interval = setInterval(() => {
        frameIdx = (frameIdx + 1) % dotsFrames.length;
        process.stdout.write(`\r${CYAN}${dotsFrames[frameIdx]}${RESET} ${msg}`);
      }, 80);
    } else {
      process.stderr.write(`${msg}...\n`);
    }
  };

  const stopSmoothSpinner = () => {
    if (interval) { clearInterval(interval); interval = null; }
    if (process.stdout.isTTY) {
      process.stdout.write('\r' + ' '.repeat(40) + '\r'); // clear line
    }
  };

  startSmoothSpinner('Thinking…');

  try {
    const { askMemoryQuestion } = await import('./tui/chat-service.js');
    const result = await askMemoryQuestion(question);

    stopSmoothSpinner();

    // Output the answer
    console.log('');
    console.log(result.answer);

    // Show sources if any
    if (result.sources.length > 0) {
      console.log('');
      console.log(`${DIM}Sources:${RESET}`);
      for (const src of result.sources.slice(0, 5)) {
        console.log(`  ${DIM}[obs:${src.id}]${RESET} ${src.title}`);
      }
    }

    // Show warnings
    if (result.warning) {
      console.log('');
      console.log(`${YELLOW}[WARN] ${result.warning}${RESET}`);
    }

    // Metadata footer
    const meta: string[] = [];
    if (result.usedLLM && result.llmModel) meta.push(result.llmModel);
    if (result.searchMode) meta.push(result.searchMode);
    if (result.toolCallsCount) meta.push(`${result.toolCallsCount} tool call${result.toolCallsCount > 1 ? 's' : ''}`);
    if (meta.length > 0) {
      console.log(`${DIM}  ${meta.join(' · ')}${RESET}`);
    }
  } catch (err) {
    stopSmoothSpinner();
    p.log.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}

// ============================================================
// Main command
// ============================================================

async function runMemoryShortcut(action: string, args: Record<string, unknown>): Promise<void> {
  const { detectProject } = await import('../project/detector.js');
  if (!detectProject(process.cwd())) {
    console.log(NO_GIT_MSG);
    process.exitCode = 1;
    return;
  }
  const memory = await import('./commands/memory.js');
  await memory.default.run?.({
    args: { ...args, _: [action] },
    rawArgs: [],
    cmd: memory.default,
  } as any);
}

const main = defineCommand({
  meta: {
    name: 'memorix',
    version: getCliVersion(),
    description: 'Local-first memory control plane for AI coding agents through CLI, MCP, and local workflows',
  },
  subCommands: {
    // One-shot product commands (primary user paths)
    ask: () => Promise.resolve(defineCommand({
      meta: { name: 'ask', description: 'Ask Memorix a question (single-shot chat). Pipe: echo "q" | memorix ask' },
      args: {
        question: { type: 'positional', description: 'Question to ask (or pipe via stdin)', required: false },
      },
      async run({ args }) {
        let q = (args.question as string) || '';
        // Read from stdin if no positional arg and stdin is piped
        if (!q && !process.stdin.isTTY) {
          q = await new Promise<string>((resolve) => {
            let data = '';
            process.stdin.setEncoding('utf-8');
            process.stdin.on('data', (chunk) => { data += chunk; });
            process.stdin.on('end', () => resolve(data.trim()));
            process.stdin.on('error', () => resolve(''));
          });
        }
        if (!q) {
          p.log.error('No question provided. Usage: memorix ask "your question" or echo "q" | memorix ask');
          return;
        }
        await runAsk(q);
      },
    })),
    search: () => Promise.resolve(defineCommand({
      meta: { name: 'search', description: 'Shortcut for `memorix memory search`' },
      args: {
        query: { type: 'positional', description: 'Search query', required: true },
        limit: { type: 'string', description: 'Maximum results' },
        quality: { type: 'string', description: 'Retrieval profile: fast, balanced (default), or thorough' },
        json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
      },
      async run({ args }) {
        await runMemoryShortcut('search', {
          query: args.query,
          limit: args.limit,
          quality: args.quality,
          json: args.json,
        });
      },
    })),
    remember: () => Promise.resolve(defineCommand({
      meta: { name: 'remember', description: 'Shortcut for `memorix memory store`' },
      args: {
        text: { type: 'positional', description: 'Text to remember', required: true },
        title: { type: 'string', description: 'Optional observation title' },
        type: { type: 'string', description: 'Observation type' },
        visibility: { type: 'string', description: 'project (default), personal, or team' },
        json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
      },
      async run({ args }) {
        await runMemoryShortcut('store', {
          text: args.text,
          title: args.title,
          type: args.type,
          visibility: args.visibility,
          json: args.json,
        });
      },
    })),
    recent: () => Promise.resolve(defineCommand({
      meta: { name: 'recent', description: 'Shortcut for `memorix memory recent`' },
      args: {
        limit: { type: 'string', description: 'Maximum results' },
        json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
      },
      async run({ args }) { await runMemoryShortcut('recent', { limit: args.limit, json: args.json }); },
    })),
    help: () => Promise.resolve(defineCommand({
      meta: { name: 'help', description: 'Show action-oriented help for a command group' },
      args: {
        command: { type: 'positional', description: 'Command group to inspect', required: false },
      },
      async run({ args }) {
        console.log(renderCliGuide(args.command as string | undefined));
      },
    })),
    // Infrastructure commands
    init: () => import('./commands/init.js').then(m => m.default),
    setup: () => import('./commands/setup.js').then(m => m.default),
    config: () => Promise.resolve(defineCommand({
      meta: { name: 'config', description: 'Inspect Memorix TOML configuration' },
      subCommands: {
        path: () => import('./commands/config-path.js').then(m => m.default),
        get: () => import('./commands/config-get.js').then(m => m.default),
        migrate: () => import('./commands/config-migrate.js').then(m => m.default),
      },
    })),
    integrate: () => import('./commands/integrate.js').then(m => m.default),
    memory: () => import('./commands/memory.js').then(m => m.default),
    context: () => import('./commands/context.js').then(m => m.default),
    resume: () => import('./commands/resume.js').then(m => m.default),
    explain: () => import('./commands/explain.js').then(m => m.default),
    codegraph: () => import('./commands/codegraph.js').then(m => m.default),
    checkpoint: () => import('./commands/checkpoint.js').then(m => m.default),
    knowledge: () => import('./commands/knowledge.js').then(m => m.default),
    evidence: () => import('./commands/evidence.js').then(m => m.default),
    feedback: () => import('./commands/feedback.js').then(m => m.default),
    reasoning: () => import('./commands/reasoning.js').then(m => m.default),
    retention: () => import('./commands/retention.js').then(m => m.default),
    formation: () => import('./commands/formation.js').then(m => m.default),
    audit: () => import('./commands/audit.js').then(m => m.default),
    transfer: () => import('./commands/transfer.js').then(m => m.default),
    skills: () => import('./commands/skills.js').then(m => m.default),
    identity: () => import('./commands/identity.js').then(m => m.default),
    session: () => import('./commands/session.js').then(m => m.default),
    team: () => import('./commands/team.js').then(m => m.default),
    task: () => import('./commands/task.js').then(m => m.default),
    message: () => import('./commands/message.js').then(m => m.default),
    lock: () => import('./commands/lock.js').then(m => m.default),
    handoff: () => import('./commands/handoff.js').then(m => m.default),
    poll: () => import('./commands/poll.js').then(m => m.default),
    receipt: () => import('./commands/receipt.js').then(m => m.default),
    serve: () => import('./commands/serve.js').then(m => m.default),
    'serve-http': () => import('./commands/serve-http.js').then(m => m.default),
    status: () => import('./commands/status.js').then(m => m.default),
    sync: () => import('./commands/sync.js').then(m => m.default),
    hook: () => import('./commands/hook.js').then(m => m.default),
    hooks: () => import('./commands/hooks.js').then(m => m.default),
    ingest: () => import('./commands/ingest.js').then(m => m.default),
    media: () => import('./commands/media.js').then(m => m.default),
    'git-hook': () => import('./commands/git-hook-install.js').then(m => m.default),
    'git-hook-uninstall': () => import('./commands/git-hook-uninstall.js').then(m => m.default),
    background: () => import('./commands/background.js').then(m => m.default),
    bg: () => import('./commands/background.js').then(m => m.default),
    bs: () => Promise.resolve(defineCommand({
      meta: { name: 'bs', description: 'Shortcut: background start' },
      args: { port: { type: 'string', description: 'HTTP port (default: 3211)', required: false } },
      async run({ args }) {
        // Directly invoke background start instead of going through citty's CommandContext
        const port = parseInt((args.port as string) || '3211', 10);
        const { doStart } = await import('./commands/background.js');
        await doStart(port);
      },
    })),
    doctor: () => import('./commands/doctor.js').then(m => m.default),
    repair: () => import('./commands/repair.js').then(m => m.default),
    dashboard: () => import('./commands/dashboard.js').then(m => m.default),
    cleanup: () => import('./commands/cleanup.js').then(m => m.default),
    purge: () => import('./commands/purge.js').then(m => m.default),
    uninstall: () => import('./commands/uninstall.js').then(m => m.default),
    orchestrate: () => import('./commands/orchestrate.js').then(m => m.default),
    workbench: () => Promise.resolve(defineCommand({
      meta: { name: 'workbench', description: 'Open the interactive terminal memory control plane' },
      async run() {
        const { startWorkbench } = await import('./workbench.js');
        await startWorkbench();
      },
    })),
    memcode: () => Promise.resolve(defineCommand({
      meta: { name: 'memcode', description: 'Enter memcode TUI — native coding agent with memory' },
      async run() {
        try {
          const { runCli } = await importBundledMemcode();
          await runCli(process.argv.slice(3));
        } catch (err) {
          console.error('Failed to start memcode:', err instanceof Error ? err.message : err);
          process.exit(1);
        }
      },
    })),
  },
  async run() {
    // Guard: if citty already resolved a subcommand, its run() was called before this.
    // Detect by checking if the first CLI arg matches a registered subcommand name.
    const firstArg = process.argv[2];
    const knownSubs = ['ask', 'search', 'remember', 'recent', 'help', 'workbench', 'memcode', 'config',
      'init', 'setup', 'integrate', 'memory', 'context', 'resume', 'explain', 'codegraph', 'checkpoint', 'knowledge', 'reasoning', 'retention', 'formation', 'audit', 'transfer', 'skills', 'identity',
      'session', 'team', 'task', 'message', 'lock', 'handoff', 'poll', 'evidence', 'feedback',
      'receipt',
      'serve', 'serve-http', 'status', 'sync',
      'hook', 'hooks', 'ingest', 'media', 'git-hook', 'git-hook-uninstall',
      'background', 'bg', 'bs', 'doctor', 'repair', 'dashboard', 'cleanup', 'purge', 'uninstall', 'orchestrate'];
    if (firstArg && knownSubs.includes(firstArg)) return;

    // No subcommand provided — enter memcode TUI (native coding agent)
    if (!firstArg) {
      try {
        const { runCli } = await importBundledMemcode();
        await runCli(process.argv.slice(2));
        return;
      } catch (err) {
        console.error('Failed to start memcode:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    }

    // Fallback: show usage hint
    if (process.stdout.isTTY && process.stdin.isTTY) {
      // Fire-and-forget: background update check. Default is notify-only; stderr only, never blocks TUI.
      import('./update-checker.js').then(m => m.checkForUpdates()).catch(() => {});
      const { startWorkbench } = await import('./workbench.js');
      await startWorkbench();
    } else {
      // Non-interactive mode: show usage hint
      console.error(`Memorix v${getCliVersion()} — Local-first memory control plane\n`);
      console.error('Usage: memorix <command>\n');
      console.error('Commands:');
      console.error('  help       Show action-oriented help (`memorix memory --help`)');
      console.error('  workbench  Open interactive terminal memory control plane');
      console.error('  memcode    Enter memcode TUI (native coding agent)');
      console.error('  ask "q"    Ask Memorix a question (single-shot chat)');
      console.error('             Pipe: echo "q" | memorix ask');
      console.error('  background Start/stop/status background control plane');
      console.error('  session    Start/end/context for coding sessions');
      console.error('  memory     Search/store/detail/timeline/resolve observations');
      console.error('  context    Show the Memory Autopilot brief for this project');
      console.error('  resume     Resume prior work with one bounded project brief');
      console.error('  explain    Explain where Memorix project context comes from');
      console.error('  codegraph  Refresh/status/context-pack for CodeGraph Memory');
      console.error('  checkpoint Inspect native compact continuity checkpoints');
      console.error('  knowledge  Review source-backed knowledge pages and project workflows');
      console.error('  evidence   Inspect source-backed evidence cards');
      console.error('  feedback   Record or audit memory feedback');
      console.error('  reasoning  Store/search decision rationale');
      console.error('  retention  Inspect stale/archive status');
      console.error('  formation  Inspect Memory Formation metrics');
      console.error('  audit      Audit trail and project attribution checks');
      console.error('  transfer   Export/import memory snapshots');
      console.error('  skills     List/generate/show project skills');
      console.error('  identity   Select the explicit CLI actor for private/team memory');
      console.error('  team       Join/status/role operations for coordination state');
      console.error('  task       Create/claim/complete/list team tasks');
      console.error('  message    Send/broadcast/read team messages');
      console.error('  lock       Manage advisory file locks');
      console.error('  handoff    Create durable handoff artifacts');
      console.error('  poll       Snapshot project coordination state');
      console.error('  receipt    Privacy-safe memory handoff diagnostic');
      console.error('  serve-http Start HTTP MCP + dashboard control plane');
      console.error('  serve      Start MCP server on stdio');
      console.error('  init       Create global defaults or project config');
      console.error('  setup      Install Memorix plugin/MCP/rules/hooks for an agent');
      console.error('  repair     Repair Memorix-owned agent integration files');
      console.error('  config     Show TOML config paths and resolved values');
      console.error('  integrate  Install one IDE integration into the current repo');
      console.error('  status     Show project info + stats');
      console.error('  dashboard  Open standalone dashboard (read-mostly)');
      console.error('  hooks      Install, inspect, or remove agent hooks');
      console.error('  cleanup    Remove old memories');
      console.error('  purge      Retire all memories (project by default, --all for everything)');
      console.error('  sync       Rules/workspace sync plus interactive wizard');
      console.error('  ingest     Ingest commit, log, or image knowledge');
      console.error('\nRun `memorix` in an interactive terminal for memcode TUI.');
    }
  },
});

try {
  normalizeCliInvocation();
  if (!printCliGuideForHelp()) {
    runMain(main);
  }
} catch (error) {
  console.error(`Memorix CLI invocation error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
