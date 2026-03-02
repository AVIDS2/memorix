/**
 * Memorix CLI
 *
 * Command-line interface for Memorix management.
 * Built with: citty (1.1K stars, zero-deps) + @clack/prompts (7.4K stars)
 *
 * Commands:
 *   memorix         — Interactive TUI menu (no args)
 *   memorix serve   — Start MCP Server on stdio
 *   memorix status  — Show project info + rules sync status
 *   memorix sync    — Interactive cross-agent rule sync
 */

import { defineCommand, runMain } from 'citty';
import { createRequire } from 'node:module';
import * as p from '@clack/prompts';
import { execSync, spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

// ============================================================
// Interactive TUI Menu
// ============================================================

async function interactiveMenu(): Promise<void> {
  p.intro(`Memorix v${pkg.version}`);

  const action = await p.select({
    message: 'What would you like to do?',
    options: [
      { value: 'search', label: 'Search memories', hint: 'find by keyword' },
      { value: 'list', label: 'View recent', hint: 'latest observations' },
      { value: 'dashboard', label: 'Open Dashboard', hint: 'localhost:3210' },
      { value: 'hooks', label: 'Install hooks', hint: 'auto-capture for IDEs' },
      { value: 'status', label: 'Project status', hint: 'info + stats' },
      { value: 'cleanup', label: 'Clean up', hint: 'remove old memories' },
      { value: 'sync', label: 'Sync rules', hint: 'cross-agent sync' },
      { value: 'serve', label: 'Start MCP server', hint: 'for IDE integration' },
    ],
  });

  if (p.isCancel(action)) {
    p.cancel('Goodbye!');
    process.exit(0);
  }

  switch (action) {
    case 'search': {
      const query = await p.text({
        message: 'Enter search query:',
        placeholder: 'e.g., authentication bug fix',
      });
      if (p.isCancel(query) || !query) {
        p.cancel('Search cancelled');
        return;
      }
      await runSearch(query);
      break;
    }
    case 'list':
      await runList();
      break;
    case 'dashboard':
      await runCommand('dashboard');
      break;
    case 'hooks':
      await runCommand('hooks', ['install']);
      break;
    case 'status':
      await runCommand('status');
      break;
    case 'cleanup':
      await runCommand('cleanup');
      break;
    case 'sync':
      await runCommand('sync');
      break;
    case 'serve':
      p.log.info('Starting MCP server on stdio...');
      await runCommand('serve');
      break;
  }
}

async function runSearch(query: string): Promise<void> {
  const s = p.spinner();
  s.start('Searching memories...');
  
  try {
    const { searchObservations, getDb } = await import('../store/orama-store.js');
    const { getProjectDataDir } = await import('../store/persistence.js');
    const { detectProject } = await import('../project/detector.js');
    const { initObservations } = await import('../memory/observations.js');
    
    const project = await detectProject(process.cwd());
    const dataDir = await getProjectDataDir(project.id);
    await initObservations(dataDir);
    await getDb(); // Ensure Orama is initialized
    
    const results = await searchObservations({ query, limit: 10, projectId: project.id });
    s.stop('Search complete');
    
    if (results.length === 0) {
      p.log.warn('No memories found matching your query.');
      return;
    }
    
    p.log.success(`Found ${results.length} memories:`);
    console.log('');
    for (const r of results) {
      console.log(`  ${r.icon} #${r.id} ${r.title}`);
      console.log(`     ${r.time} | ${r.tokens} tokens | score: ${(r.score ?? 0).toFixed(2)}`);
      console.log('');
    }
  } catch (err) {
    s.stop('Search failed');
    p.log.error(`Error: ${err instanceof Error ? err.message : err}`);
  }
}

async function runList(): Promise<void> {
  const s = p.spinner();
  s.start('Loading recent memories...');
  
  try {
    const { getProjectDataDir, loadObservationsJson } = await import('../store/persistence.js');
    const { detectProject } = await import('../project/detector.js');
    
    const project = await detectProject(process.cwd());
    const dataDir = await getProjectDataDir(project.id);
    const observations = await loadObservationsJson(dataDir) as Array<{
      id: number; title: string; type: string; timestamp: string; status?: string;
    }>;
    
    const active = observations.filter(o => (o.status ?? 'active') === 'active');
    const recent = active.slice(-10).reverse();
    
    s.stop(`Project: ${project.name} (${active.length} active memories)`);
    
    if (recent.length === 0) {
      p.log.warn('No memories found.');
      return;
    }
    
    console.log('');
    for (const o of recent) {
      const typeLabel = { gotcha: '[!]', decision: '[D]', 'problem-solution': '[S]', discovery: '[?]', 'how-it-works': '[H]', 'what-changed': '[C]' }[o.type] ?? '[·]';
      console.log(`  ${typeLabel} #${o.id} ${o.title?.slice(0, 60) ?? '(untitled)'}`);
    }
    console.log('');
  } catch (err) {
    s.stop('Failed to load memories');
    p.log.error(`Error: ${err instanceof Error ? err.message : err}`);
  }
}

async function runCommand(cmd: string, _args: string[] = []): Promise<void> {
  // Direct imports to ensure bundler includes them
  // Using 'as any' to bypass citty's strict type checking for manual invocation
  switch (cmd) {
    case 'dashboard': {
      const m = await import('./commands/dashboard.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
    case 'hooks': {
      const m = await import('./commands/hooks.js');
      await m.default.run?.({ args: { _: ['install'] }, rawArgs: ['install'], cmd: m.default } as any);
      break;
    }
    case 'status': {
      const m = await import('./commands/status.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
    case 'cleanup': {
      const m = await import('./commands/cleanup.js');
      await m.default.run?.({ args: { _: [], dry: false, force: false }, rawArgs: [], cmd: m.default } as any);
      break;
    }
    case 'sync': {
      const m = await import('./commands/sync.js');
      await m.default.run?.({ args: { _: [], dry: false }, rawArgs: [], cmd: m.default } as any);
      break;
    }
    case 'serve': {
      const m = await import('./commands/serve.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
  }
}

// ============================================================
// Main command
// ============================================================

const main = defineCommand({
  meta: {
    name: 'memorix',
    version: pkg.version,
    description: 'Cross-Agent Memory Bridge — Universal memory layer for AI coding agents via MCP',
  },
  subCommands: {
    serve: () => import('./commands/serve.js').then(m => m.default),
    status: () => import('./commands/status.js').then(m => m.default),
    sync: () => import('./commands/sync.js').then(m => m.default),
    hook: () => import('./commands/hook.js').then(m => m.default),
    hooks: () => import('./commands/hooks.js').then(m => m.default),
    dashboard: () => import('./commands/dashboard.js').then(m => m.default),
    cleanup: () => import('./commands/cleanup.js').then(m => m.default),
  },
  async run() {
    // No subcommand provided — show interactive TUI menu if in TTY, otherwise show help
    if (process.stdout.isTTY && process.stdin.isTTY) {
      await interactiveMenu();
    } else {
      // Non-interactive mode: show usage hint
      console.log(`🧠 Memorix v${pkg.version} — Cross-Agent Memory Bridge\n`);
      console.log('Usage: memorix <command>\n');
      console.log('Commands:');
      console.log('  serve      Start MCP Server on stdio');
      console.log('  status     Show project info + stats');
      console.log('  dashboard  Open Web Dashboard');
      console.log('  hooks      Install hooks for IDEs');
      console.log('  cleanup    Remove old memories');
      console.log('  sync       Cross-agent rule sync');
      console.log('\nRun `memorix` in an interactive terminal for guided menu.');
    }
  },
});

runMain(main);
