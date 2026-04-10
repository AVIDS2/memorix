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

const NO_GIT_MSG = 'Memorix requires a git repo to establish project identity. Run `git init` in this workspace first.';

// ============================================================
// Workbench — Terminal-native memory control plane
// ============================================================

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';

async function getWorkbenchHeader(): Promise<string[]> {
  const lines: string[] = [];
  const ver = `v${pkg.version}`;

  // Detect project
  let projectLabel = `${YELLOW}no git repo${RESET} ${DIM}— run \`git init\` to enable${RESET}`;
  let projectDetected = false;
  try {
    const { detectProject } = await import('../project/detector.js');
    const proj = detectProject(process.cwd());
    if (proj) {
      projectLabel = `${BOLD}${proj.name}${RESET} ${DIM}(${proj.id})${RESET}`;
      projectDetected = true;
    }
  } catch { /* ignore */ }

  // Detect mode
  let modeLabel = `${DIM}CLI${RESET}`;
  try {
    const { existsSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const bgPath = join(homedir(), '.memorix', 'background.json');
    if (existsSync(bgPath)) {
      const bg = JSON.parse(readFileSync(bgPath, 'utf-8'));
      try { process.kill(bg.pid, 0); modeLabel = `${GREEN}Background${RESET} ${DIM}(port ${bg.port})${RESET}`; } catch { /* dead */ }
    }
  } catch { /* ignore */ }

  // Detect embedding
  let searchLabel = `${DIM}fulltext (BM25)${RESET}`;
  try {
    const { getEmbeddingMode } = await import('../config.js');
    const mode = getEmbeddingMode();
    if (mode !== 'off') {
      searchLabel = `${CYAN}hybrid${RESET} ${DIM}(BM25 + vector)${RESET}`;
    }
  } catch { /* ignore */ }

  // Count memories
  let memLabel = `${DIM}unknown${RESET}`;
  if (projectDetected) {
    try {
      const { detectProject } = await import('../project/detector.js');
      const { getProjectDataDir } = await import('../store/persistence.js');
      const { initObservationStore: initStore } = await import('../store/obs-store.js');
      const proj = detectProject(process.cwd());
      if (proj) {
        const dataDir = await getProjectDataDir(proj.id);
        const { existsSync } = await import('node:fs');
        const { join } = await import('node:path');
        const obsFile = join(dataDir, 'observations.json');
        if (existsSync(obsFile)) {
          await initStore(dataDir);
          const { getObservationStore: getStore } = await import('../store/obs-store.js');
          const obs = await getStore().loadAll() as any[];
          const active = obs.filter((o: any) => (o.status ?? 'active') === 'active').length;
          memLabel = `${BOLD}${active}${RESET} ${DIM}active${RESET}`;
        }
      }
    } catch { /* ignore */ }
  }

  lines.push('');
  lines.push(`  ${BOLD}Memorix Workbench${RESET}${DIM}${' '.repeat(36)}${ver}${RESET}`);
  lines.push(`  ${DIM}${'─'.repeat(55)}${RESET}`);
  lines.push(`  ${DIM}Project${RESET}    ${projectLabel}`);
  lines.push(`  ${DIM}Mode${RESET}       ${modeLabel}`);
  lines.push(`  ${DIM}Search${RESET}     ${searchLabel}`);
  lines.push(`  ${DIM}Memories${RESET}   ${memLabel}`);
  lines.push(`  ${DIM}${'─'.repeat(55)}${RESET}`);
  lines.push('');

  return lines;
}

function printSlashHelp(): void {
  console.log('');
  console.log(`  ${BOLD}Commands${RESET}`);
  console.log(`  ${DIM}${'─'.repeat(45)}${RESET}`);
  console.log(`  ${CYAN}/search${RESET} ${DIM}<query>${RESET}    Search memories`);
  console.log(`  ${CYAN}/remember${RESET} ${DIM}<text>${RESET}  Store a quick memory`);
  console.log(`  ${CYAN}/recent${RESET}            View recent memories`);
  console.log(`  ${CYAN}/doctor${RESET}            System diagnostics`);
  console.log(`  ${CYAN}/project${RESET}           Project details`);
  console.log(`  ${CYAN}/background${RESET}        Background service`);
  console.log(`  ${CYAN}/dashboard${RESET}         Open dashboard`);
  console.log(`  ${CYAN}/configure${RESET}         Settings`);
  console.log(`  ${CYAN}/integrate${RESET}         Set up an IDE`);
  console.log(`  ${CYAN}/exit${RESET}              Exit workbench`);
  console.log(`  ${DIM}${'─'.repeat(45)}${RESET}`);
  console.log(`  ${DIM}Or just type to search memories directly.${RESET}`);
  console.log('');
}

async function runRemember(text: string): Promise<void> {
  const s = p.spinner();
  s.start('Storing memory...');

  try {
    const { detectProject } = await import('../project/detector.js');
    const { getProjectDataDir } = await import('../store/persistence.js');
    const { initObservations, storeObservation } = await import('../memory/observations.js');
    const { initObservationStore } = await import('../store/obs-store.js');

    const proj = detectProject(process.cwd());
    if (!proj) { s.stop('No git repo'); p.log.error(NO_GIT_MSG); return; }
    const dataDir = await getProjectDataDir(proj.id);
    await initObservationStore(dataDir);
    await initObservations(dataDir);

    const result = await storeObservation({
      entityName: 'quick-note',
      type: 'discovery',
      title: text.slice(0, 100),
      narrative: text,
      facts: [],
      projectId: proj.id,
      sourceDetail: 'explicit',
    });

    s.stop('Stored');
    p.log.success(`Memory #${result.observation.id} saved: ${text.slice(0, 60)}${text.length > 60 ? '...' : ''}`);
  } catch (err) {
    s.stop('Failed');
    p.log.error(`Error: ${err instanceof Error ? err.message : err}`);
  }
}

async function workbench(): Promise<void> {
  // Print header
  const header = await getWorkbenchHeader();
  for (const line of header) console.log(line);

  console.log(`  ${DIM}Type to search memories, or /help for commands.${RESET}`);
  console.log('');

  // Main input loop
  while (true) {
    const input = await p.text({
      message: `${CYAN}>${RESET}`,
      placeholder: 'search memories or /command',
    });

    if (p.isCancel(input)) {
      p.outro(`${DIM}Goodbye${RESET}`);
      process.exit(0);
    }

    const raw = (input || '').trim();
    if (!raw) continue;

    // Slash command routing
    if (raw.startsWith('/')) {
      const parts = raw.slice(1).split(/\s+/);
      const cmd = parts[0]?.toLowerCase();
      const arg = parts.slice(1).join(' ');

      switch (cmd) {
        case 'search':
        case 's':
          if (arg) { await runSearch(arg); } else {
            const q = await p.text({ message: 'Search query:', placeholder: 'e.g., authentication bug' });
            if (!p.isCancel(q) && q) await runSearch(q);
          }
          break;
        case 'remember':
        case 'r':
          if (arg) { await runRemember(arg); } else {
            const t = await p.text({ message: 'What to remember:', placeholder: 'e.g., Use path.join for Windows' });
            if (!p.isCancel(t) && t) await runRemember(t);
          }
          break;
        case 'recent':
          await runList();
          break;
        case 'doctor':
          await runCommand('doctor');
          break;
        case 'project':
        case 'status':
          await runCommand('status');
          break;
        case 'background':
        case 'bg':
          await runBackgroundMenu();
          break;
        case 'dashboard':
        case 'dash':
          await runCommand('dashboard');
          return;
        case 'configure':
        case 'config':
          await runConfigure();
          break;
        case 'integrate':
        case 'setup': {
          const m = await import('./commands/integrate.js');
          await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
          break;
        }
        case 'serve':
          p.log.info('Starting MCP server on stdio...');
          await runCommand('serve');
          return;
        case 'serve-http':
          p.log.info('Starting control plane...');
          await runCommand('serve-http');
          return;
        case 'sync':
          await runCommand('sync');
          break;
        case 'cleanup':
          await runCleanupMenu();
          break;
        case 'ingest':
          await runIngestMenu();
          break;
        case 'help':
        case '?':
          printSlashHelp();
          break;
        case 'exit':
        case 'quit':
        case 'q':
          p.outro(`${DIM}Goodbye${RESET}`);
          process.exit(0);
          break; // unreachable
        default:
          p.log.warn(`Unknown command: /${cmd}. Type /help for available commands.`);
      }
    } else {
      // Default: treat as search query
      await runSearch(raw);
    }

    console.log(''); // spacing
  }
}

async function runBackgroundMenu(): Promise<void> {
  const action = await p.select({
    message: 'Background Control Plane:',
    options: [
      { value: 'start', label: 'Start', hint: 'launch control plane in background' },
      { value: 'stop', label: 'Stop', hint: 'stop the background service' },
      { value: 'status', label: 'Status', hint: 'show running state & health' },
      { value: 'restart', label: 'Restart', hint: 'stop + start' },
      { value: 'logs', label: 'View logs', hint: 'show recent log output' },
      { value: 'back', label: '\u2190 Back', hint: 'return to main menu' },
    ],
  });

  if (p.isCancel(action) || action === 'back') return;

  const m = await import('./commands/background.js');
  // Synthesize citty args with the chosen subcommand
  await m.default.run?.({
    args: { _: [action], port: '3211', follow: false, lines: '50' },
    rawArgs: [action],
    cmd: m.default,
  } as any);
}

async function runHooksMenu(): Promise<void> {
  const action = await p.select({
    message: 'Hooks management:',
    options: [
      { value: 'install', label: 'Install hooks', hint: 'legacy compatibility path' },
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

async function runIngestMenu(): Promise<void> {
  const action = await p.select({
    message: 'Git → Memory:',
    options: [
      { value: 'commit', label: 'Ingest commit', hint: 'single commit → memory' },
      { value: 'log', label: 'Ingest log', hint: 'batch recent commits → memories' },
      { value: 'git-hook', label: 'Install git hook', hint: 'auto-capture on every commit' },
      { value: 'git-hook-uninstall', label: 'Uninstall git hook', hint: 'remove auto-capture' },
      { value: 'back', label: '← Back', hint: 'return to main menu' },
    ],
  });

  if (p.isCancel(action) || action === 'back') return;

  switch (action) {
    case 'commit': {
      const m = await import('./commands/ingest-commit.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
    case 'log': {
      const m = await import('./commands/ingest-log.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
    case 'git-hook': {
      const m = await import('./commands/git-hook-install.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
    case 'git-hook-uninstall': {
      const m = await import('./commands/git-hook-uninstall.js');
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

      const formationMode = await p.select({
        message: `Formation Pipeline mode (current: ${current.formationMode ?? 'active'})`,
        options: [
          { value: 'active', label: 'Active (default)', hint: 'Formation decides storage (new/merge/evolve/discard)' },
          { value: 'shadow', label: 'Shadow', hint: 'Formation observes only, old compact decides' },
          { value: 'fallback', label: 'Fallback', hint: 'Old compact decides (safe rollback)' },
        ],
      });
      if (p.isCancel(formationMode)) continue;

      config.behavior = {
        sessionInject,
        syncAdvisory,
        autoCleanup,
        formationMode,
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
  const perf = !!process.env.MEMORIX_PERF;
  const t0 = perf ? performance.now() : 0;
  const mark = (label: string) => { if (perf) { const now = performance.now(); process.stderr.write(`[perf] ${label}: ${(now - t0).toFixed(0)}ms\n`); } };
  
  try {
    const { searchObservations, getDb, hydrateIndex } = await import('../store/orama-store.js');
    const { getProjectDataDir } = await import('../store/persistence.js');
    const { detectProject } = await import('../project/detector.js');
    const { initObservations } = await import('../memory/observations.js');
    const { initObservationStore } = await import('../store/obs-store.js');
    mark('imports');
    
    const project = detectProject(process.cwd());
    if (!project) { s.stop('No git repo'); p.log.error(NO_GIT_MSG); return; }
    const dataDir = await getProjectDataDir(project.id);
    mark('detectProject');
    await initObservationStore(dataDir);
    await initObservations(dataDir);
    mark('initObservations');

    // Parallel: getDb (embedding provider init) + store.loadAll (disk I/O)
    const { getObservationStore: getStore } = await import('../store/obs-store.js');
    const [, allObs] = await Promise.all([
      getDb(),
      getStore().loadAll() as Promise<any[]>,
    ]);
    mark(`getDb+loadObs(${allObs.length})`);
    await hydrateIndex(allObs);
    mark('hydrateIndex');
    
    const results = await searchObservations({ query, limit: 10, projectId: project.id });
    mark('search');
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
    const { getProjectDataDir } = await import('../store/persistence.js');
    const { detectProject } = await import('../project/detector.js');
    const { initObservationStore: initStore, getObservationStore: getStore } = await import('../store/obs-store.js');
    
    const project = detectProject(process.cwd());
    if (!project) { s.stop('No git repo'); p.log.error(NO_GIT_MSG); return; }
    const dataDir = await getProjectDataDir(project.id);
    await initStore(dataDir);
    const observations = await getStore().loadAll() as unknown as Array<{
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
    case 'serve-http': {
      const m = await import('./commands/serve-http.js');
      await m.default.run?.({ args: { _: [], port: 3211 }, rawArgs: [], cmd: m.default } as any);
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
    description: 'Local-first memory control plane for AI coding agents via MCP',
  },
  subCommands: {
    // One-shot product commands (primary user paths)
    search: () => Promise.resolve(defineCommand({
      meta: { name: 'search', description: 'Search memories' },
      args: { query: { type: 'positional', description: 'Search query', required: true } },
      async run({ args }) { await runSearch(args.query as string); },
    })),
    remember: () => Promise.resolve(defineCommand({
      meta: { name: 'remember', description: 'Store a quick memory' },
      args: { text: { type: 'positional', description: 'Text to remember', required: true } },
      async run({ args }) { await runRemember(args.text as string); },
    })),
    recent: () => Promise.resolve(defineCommand({
      meta: { name: 'recent', description: 'View recent memories' },
      async run() { await runList(); },
    })),
    // Infrastructure commands
    init: () => import('./commands/init.js').then(m => m.default),
    integrate: () => import('./commands/integrate.js').then(m => m.default),
    serve: () => import('./commands/serve.js').then(m => m.default),
    'serve-http': () => import('./commands/serve-http.js').then(m => m.default),
    status: () => import('./commands/status.js').then(m => m.default),
    sync: () => import('./commands/sync.js').then(m => m.default),
    hook: () => import('./commands/hook.js').then(m => m.default),
    hooks: () => import('./commands/hooks.js').then(m => m.default),
    ingest: () => import('./commands/ingest.js').then(m => m.default),
    'git-hook': () => import('./commands/git-hook-install.js').then(m => m.default),
    'git-hook-uninstall': () => import('./commands/git-hook-uninstall.js').then(m => m.default),
    background: () => import('./commands/background.js').then(m => m.default),
    doctor: () => import('./commands/doctor.js').then(m => m.default),
    dashboard: () => import('./commands/dashboard.js').then(m => m.default),
    cleanup: () => import('./commands/cleanup.js').then(m => m.default),
    orchestrate: () => import('./commands/orchestrate.js').then(m => m.default),
  },
  async run() {
    // Guard: if citty already resolved a subcommand, its run() was called before this.
    // Detect by checking if the first CLI arg matches a registered subcommand name.
    const firstArg = process.argv[2];
    const knownSubs = ['search', 'remember', 'recent',
      'init', 'integrate', 'serve', 'serve-http', 'status', 'sync',
      'hook', 'hooks', 'ingest', 'git-hook', 'git-hook-uninstall',
      'background', 'doctor', 'dashboard', 'cleanup', 'orchestrate'];
    if (firstArg && knownSubs.includes(firstArg)) return;

    // No subcommand provided — show fullscreen workbench if in TTY, otherwise show help
    if (process.stdout.isTTY && process.stdin.isTTY) {
      // Fire-and-forget: silent auto-update check. stderr only, never blocks TUI.
      import('./update-checker.js').then(m => m.checkForUpdates()).catch(() => {});
      const { startWorkbench } = await import('./workbench.js');
      await startWorkbench();
    } else {
      // Non-interactive mode: show usage hint
      console.error(`Memorix v${pkg.version} — Local-first memory control plane\n`);
      console.error('Usage: memorix <command>\n');
      console.error('Commands:');
      console.error('  background Start/stop/status background control plane');
      console.error('  serve-http Start HTTP MCP + dashboard control plane');
      console.error('  serve      Start MCP server on stdio');
      console.error('  init       Create global defaults or project config');
      console.error('  integrate  Install one IDE integration into the current repo');
      console.error('  status     Show project info + stats');
      console.error('  dashboard  Open standalone dashboard (read-mostly)');
      console.error('  hooks      Open legacy hook installer menu');
      console.error('  cleanup    Remove old memories');
      console.error('  sync       Cross-agent rule sync');
      console.error('\nRun `memorix` in an interactive terminal for guided menu.');
    }
  },
});

runMain(main);
