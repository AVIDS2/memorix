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

  // Loop until user exits or chooses a blocking action
  while (true) {
    const action = await p.select({
      message: 'What would you like to do?',
      options: [
        { value: 'search', label: 'Search memories', hint: 'find by keyword' },
        { value: 'list', label: 'View recent', hint: 'latest observations' },
        { value: 'dashboard', label: 'Open Dashboard', hint: 'localhost:3210' },
        { value: 'hooks', label: 'Install hooks', hint: 'auto-capture for IDEs' },
        { value: 'status', label: 'Project status', hint: 'info + stats' },
        { value: 'cleanup', label: 'Clean up', hint: 'remove old memories' },
        { value: 'audit', label: 'Audit trail', hint: 'Memorix-written files' },
        { value: 'sync', label: 'Sync rules', hint: 'cross-agent sync' },
        { value: 'configure', label: 'Configure', hint: 'LLM + embedding settings' },
        { value: 'serve', label: 'Start MCP server', hint: 'for IDE integration' },
        { value: 'exit', label: 'Exit', hint: 'quit memorix' },
      ],
    });

    if (p.isCancel(action) || action === 'exit') {
      p.outro('Goodbye!');
      process.exit(0);
    }

    switch (action) {
      case 'search': {
        const query = await p.text({
          message: 'Enter search query:',
          placeholder: 'e.g., authentication bug fix',
        });
        if (p.isCancel(query) || !query) {
          continue; // Back to menu
        }
        await runSearch(query);
        break;
      }
      case 'list':
        await runList();
        break;
      case 'dashboard':
        await runCommand('dashboard');
        return; // Dashboard is blocking, exit after
      case 'hooks':
        await runHooksMenu();
        break;
      case 'status':
        await runCommand('status');
        break;
      case 'cleanup':
        await runCleanupMenu();
        break;
      case 'audit':
        await runAuditList();
        break;
      case 'sync':
        await runCommand('sync');
        break;
      case 'configure':
        await runConfigure();
        break;
      case 'serve':
        p.log.info('Starting MCP server on stdio...');
        await runCommand('serve');
        return; // Serve is blocking, exit after
    }
    
    console.log(''); // Add spacing before next menu
  }
}

async function runHooksMenu(): Promise<void> {
  const action = await p.select({
    message: 'Hooks management:',
    options: [
      { value: 'install', label: 'Install hooks', hint: 'set up auto-capture' },
      { value: 'preview', label: 'Preview installation', hint: 'show files to be created' },
      { value: 'uninstall', label: 'Uninstall hooks', hint: 'remove from all agents' },
      { value: 'status', label: 'Status', hint: 'show installed hooks' },
      { value: 'back', label: '← Back', hint: 'return to main menu' },
    ],
  });

  if (p.isCancel(action) || action === 'back') return;

  switch (action) {
    case 'install': {
      const m = await import('./commands/hooks-install.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
    case 'preview': {
      const m = await import('./commands/hooks-preview.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
    case 'uninstall': {
      const m = await import('./commands/hooks-uninstall.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
    case 'status': {
      const m = await import('./commands/hooks-status.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
  }
}

async function runCleanupMenu(): Promise<void> {
  const action = await p.select({
    message: 'Cleanup options:',
    options: [
      { value: 'project-artifacts', label: 'Uninstall project artifacts', hint: 'remove hook files only' },
      { value: 'project-memory', label: 'Purge project memory', hint: 'delete current project memories' },
      { value: 'all-memory', label: 'Purge all memory', hint: '⚠️ delete ALL memories' },
      { value: 'back', label: '← Back', hint: 'return to main menu' },
    ],
  });

  if (p.isCancel(action) || action === 'back') return;

  switch (action) {
    case 'project-artifacts': {
      const m = await import('./commands/uninstall-project-artifacts.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
    case 'project-memory': {
      const m = await import('./commands/purge-project-memory.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
    case 'all-memory': {
      const m = await import('./commands/purge-all-memory.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
  }
}

async function runAuditList(): Promise<void> {
  const m = await import('./commands/audit-list.js');
  await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
}

async function runConfigure(): Promise<void> {
  const configPath = `${process.env.HOME || process.env.USERPROFILE}/.memorix/config.json`;

  // Helper: load config from disk
  const loadConfig = async () => {
    try {
      const fs = await import('node:fs');
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch { /* ignore */ }
    return {};
  };

  // Helper: save config to disk
  const saveConfig = async (config: Record<string, unknown>) => {
    const fs = await import('node:fs');
    const dir = `${process.env.HOME || process.env.USERPROFILE}/.memorix`;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  };

  // Loop: configure multiple things without going back to main menu
  while (true) {
    const config = await loadConfig();

    const section = await p.select({
      message: 'What would you like to configure?',
      options: [
        { value: 'llm', label: 'LLM Enhanced Mode', hint: 'smart dedup + fact extraction' },
        { value: 'embedding', label: 'Embedding Provider', hint: 'semantic search' },
        { value: 'behavior', label: 'Behavior Settings', hint: 'session inject, auto-cleanup, sync advisory' },
        { value: 'show', label: 'Show current config', hint: 'view settings' },
        { value: 'back', label: '\u2190 Back', hint: 'return to main menu' },
      ],
    });

    if (p.isCancel(section) || section === 'back') return;

    if (section === 'show') {
      console.log('\nCurrent configuration:');
      console.log(`  Config file: ${configPath}`);
      console.log(`  LLM Provider: ${config.llm?.provider ?? 'not configured'}`);
      console.log(`  LLM Model: ${config.llm?.model ?? 'default'}`);
      console.log(`  LLM Base URL: ${config.llm?.baseUrl ?? '(default)'}`);
      console.log(`  LLM API Key: ${config.llm?.apiKey ? '***configured***' : 'not set'}`);
      console.log(`  Embedding: ${config.embedding ?? 'off (BM25 only)'}`);
      if (config.embedding === 'api') {
        const apiConf = config.embeddingApi;
        if (apiConf) {
          console.log(`  Embedding Model: ${apiConf.model ?? 'text-embedding-3-small'}`);
          console.log(`  Embedding Base URL: ${apiConf.baseUrl ?? '(default)'}`);
          console.log(`  Embedding API Key: ${apiConf.apiKey ? '***configured***' : '(reusing LLM key)'}`);
          if (apiConf.dimensions) console.log(`  Embedding Dimensions: ${apiConf.dimensions}`);
        }
      }
      console.log('\nEnvironment overrides (take priority over config.json):');
      console.log(`  MEMORIX_LLM_API_KEY: ${process.env.MEMORIX_LLM_API_KEY ? '***set***' : 'not set'}`);
      console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '***set***' : 'not set'}`);
      console.log(`  MEMORIX_EMBEDDING: ${process.env.MEMORIX_EMBEDDING ?? 'not set'}`);
      if (process.env.MEMORIX_EMBEDDING === 'api') {
        console.log(`  MEMORIX_EMBEDDING_API_KEY: ${process.env.MEMORIX_EMBEDDING_API_KEY ? '***set***' : 'not set'}`);
        console.log(`  MEMORIX_EMBEDDING_BASE_URL: ${process.env.MEMORIX_EMBEDDING_BASE_URL ?? 'not set'}`);
        console.log(`  MEMORIX_EMBEDDING_MODEL: ${process.env.MEMORIX_EMBEDDING_MODEL ?? 'text-embedding-3-small'}`);
        console.log(`  MEMORIX_EMBEDDING_DIMENSIONS: ${process.env.MEMORIX_EMBEDDING_DIMENSIONS ?? 'auto'}`);
      }
      console.log('');
      continue; // Back to configure menu
    }

    if (section === 'llm') {
      const provider = await p.select({
        message: 'Select LLM provider:',
        options: [
          { value: 'openai', label: 'OpenAI', hint: 'gpt-4o-mini recommended' },
          { value: 'anthropic', label: 'Anthropic', hint: 'claude-3-haiku' },
          { value: 'openrouter', label: 'OpenRouter', hint: 'multi-provider' },
          { value: 'custom', label: 'Custom endpoint', hint: 'OpenAI-compatible proxy / local' },
          { value: 'disable', label: 'Disable LLM', hint: 'use free heuristic mode' },
        ],
      });

      if (p.isCancel(provider)) continue; // Back to configure menu

      if (provider === 'disable') {
        config.llm = undefined;
        await saveConfig(config);
        p.log.success('LLM mode disabled. Using free heuristic deduplication.');
        continue;
      }

      const apiKey = await p.password({
        message: 'Enter API key:',
      });

      if (p.isCancel(apiKey) || !apiKey) {
        continue; // Back to configure menu
      }

      let defaultModel = 'gpt-4o-mini';
      if (provider === 'anthropic') defaultModel = 'claude-3-haiku-20240307';

      // Custom endpoint always asks for base URL first
      let baseUrl: string | undefined;
      if (provider === 'custom') {
        const url = await p.text({
          message: 'Base URL (OpenAI-compatible):',
          placeholder: 'http://localhost:11434/v1',
        });
        if (p.isCancel(url)) { continue; }
        if (url) baseUrl = url;
      }

      const customModel = await p.text({
        message: 'Model name:',
        placeholder: defaultModel,
        defaultValue: defaultModel,
      });

      if (p.isCancel(customModel)) { continue; }

      config.llm = {
        provider: provider === 'custom' ? 'openai' : provider,
        apiKey,
        model: customModel || defaultModel,
        baseUrl,
      };

      await saveConfig(config);
      p.log.success(`LLM configured: ${config.llm.model} @ ${config.llm.baseUrl || 'default'}`);
      p.log.info('Saved to config.json. Restart MCP server to apply.');
      continue;
    }

    if (section === 'embedding') {
      const embedding = await p.select({
        message: 'Select embedding provider:',
        options: [
          { value: 'off', label: 'Off (default)', hint: 'BM25 fulltext only, ~50MB RAM' },
          { value: 'api', label: 'API (recommended)', hint: 'OpenAI-compatible, zero local RAM, best quality' },
          { value: 'fastembed', label: 'FastEmbed', hint: 'local ONNX, ~300MB RAM' },
          { value: 'transformers', label: 'Transformers', hint: 'local JS/WASM, ~500MB RAM' },
        ],
      });

      if (p.isCancel(embedding)) continue; // Back to configure menu

      if (embedding === 'api') {
        const apiKey = await p.password({
          message: 'Embedding API key (leave empty to reuse LLM key):',
        });

        if (p.isCancel(apiKey)) continue;

        const baseUrl = await p.text({
          message: 'Base URL:',
          placeholder: 'https://api.openai.com/v1',
          defaultValue: '',
        });

        if (p.isCancel(baseUrl)) continue;

        const modelChoice = await p.select({
          message: 'Embedding model:',
          options: [
            { value: 'text-embedding-3-small', label: 'OpenAI text-embedding-3-small', hint: '1536d, $0.02/1M tokens' },
            { value: 'text-embedding-3-large', label: 'OpenAI text-embedding-3-large', hint: '3072d, best quality' },
            { value: 'text-embedding-v3', label: 'Qwen text-embedding-v3', hint: '1024d, Chinese+English' },
            { value: 'text-embedding-v4', label: 'Qwen text-embedding-v4', hint: 'latest, Chinese+English' },
            { value: 'custom', label: 'Custom model', hint: 'enter model name' },
          ],
        });

        if (p.isCancel(modelChoice)) continue;

        let model: string = modelChoice;
        if (modelChoice === 'custom') {
          const customName = await p.text({
            message: 'Model name:',
            placeholder: 'e.g., BAAI/bge-m3',
          });
          if (p.isCancel(customName) || !customName) continue;
          model = customName;
        }

        const dimInput = await p.text({
          message: 'Dimension override (optional, press Enter to auto-detect):',
          placeholder: 'e.g., 512 for cost savings',
          defaultValue: '',
        });

        const dims = (!p.isCancel(dimInput) && dimInput) ? parseInt(dimInput, 10) : null;

        config.embedding = 'api';
        config.embeddingApi = {
          apiKey: apiKey || undefined,
          baseUrl: baseUrl || undefined,
          model,
          dimensions: (dims && !isNaN(dims)) ? dims : undefined,
        };

        await saveConfig(config);
        p.log.success(`API embedding configured: ${model}`);
        p.log.info('Saved to config.json. Restart MCP server to apply.');
        continue;
      }

      config.embedding = embedding;
      delete config.embeddingApi;

      await saveConfig(config);

      if (embedding === 'off') {
        p.log.success('Embedding disabled. Using BM25 fulltext search.');
      } else {
        p.log.success(`Embedding set to: ${embedding}`);
        p.log.info(`Install with: npm install -g ${embedding === 'fastembed' ? 'fastembed' : '@huggingface/transformers'}`);
      }
      p.log.info('Saved to config.json. Restart MCP server to apply.');
      continue;
    }

    if (section === 'behavior') {
      const current = config.behavior ?? {};

      const sessionInject = await p.select({
        message: `Session start injection (current: ${current.sessionInject ?? 'minimal'})`,
        options: [
          { value: 'full', label: 'Full', hint: 'inject top 5 memories on session start' },
          { value: 'minimal', label: 'Minimal (default)', hint: 'one-line hint only' },
          { value: 'silent', label: 'Silent', hint: 'no injection, rely on rules/AGENTS.md' },
        ],
      });
      if (p.isCancel(sessionInject)) continue;

      const syncAdvisory = await p.confirm({
        message: `Show sync advisory on first search? (current: ${current.syncAdvisory !== false ? 'yes' : 'no'})`,
        initialValue: current.syncAdvisory !== false,
      });
      if (p.isCancel(syncAdvisory)) continue;

      const autoCleanup = await p.confirm({
        message: `Auto-archive expired memories on startup? (current: ${current.autoCleanup !== false ? 'yes' : 'no'})`,
        initialValue: current.autoCleanup !== false,
      });
      if (p.isCancel(autoCleanup)) continue;

      config.behavior = {
        sessionInject,
        syncAdvisory,
        autoCleanup,
      };

      await saveConfig(config);
      p.log.success('Behavior settings updated.');
      p.log.info('Saved to config.json. Restart MCP server to apply.');
      continue;
    }
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
    'serve-http': () => import('./commands/serve-http.js').then(m => m.default),
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
      console.error(`Memorix v${pkg.version} — Cross-Agent Memory Bridge\n`);
      console.error('Usage: memorix <command>\n');
      console.error('Commands:');
      console.error('  serve      Start MCP Server on stdio');
      console.error('  status     Show project info + stats');
      console.error('  dashboard  Open Web Dashboard');
      console.error('  hooks      Install hooks for IDEs');
      console.error('  cleanup    Remove old memories');
      console.error('  sync       Cross-agent rule sync');
      console.error('\nRun `memorix` in an interactive terminal for guided menu.');
    }
  },
});

runMain(main);
