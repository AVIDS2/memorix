/**
 * Interactive Commands — @clack/prompts flows that run outside of Ink
 *
 * These commands use interactive prompts (select, text, confirm) that
 * require normal stdin/stdout. They're called when the user exits the
 * Ink TUI temporarily.
 */

import * as p from '@clack/prompts';
import * as fs from 'node:fs';

// ── Configure ──────────────────────────────────────────────────

export async function runConfigureInline(): Promise<void> {
  const configPath = `${process.env.HOME || process.env.USERPROFILE}/.memorix/config.json`;

  const loadConfig = () => {
    try {
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch { /* ignore */ }
    return {};
  };

  const saveConfig = (config: Record<string, unknown>) => {
    const dir = `${process.env.HOME || process.env.USERPROFILE}/.memorix`;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  };

  while (true) {
    const config = loadConfig();

    const section = await p.select({
      message: 'What would you like to configure?',
      options: [
        { value: 'llm', label: 'LLM Enhanced Mode', hint: 'smart dedup + fact extraction' },
        { value: 'embedding', label: 'Embedding Provider', hint: 'semantic search' },
        { value: 'behavior', label: 'Behavior Settings', hint: 'session inject, auto-cleanup' },
        { value: 'show', label: 'Show current config', hint: 'view settings' },
        { value: 'back', label: '← Back', hint: 'return to workbench' },
      ],
    });

    if (p.isCancel(section) || section === 'back') return;

    if (section === 'show') {
      console.log('\nCurrent configuration:');
      console.log(`  Config file: ${configPath}`);
      console.log(`  LLM Provider: ${config.llm?.provider ?? 'not configured'}`);
      console.log(`  LLM Model: ${config.llm?.model ?? 'default'}`);
      console.log(`  Embedding: ${config.embedding ?? 'off (BM25 only)'}`);
      console.log('');
      continue;
    }

    if (section === 'llm') {
      const provider = await p.select({
        message: 'Select LLM provider:',
        options: [
          { value: 'openai', label: 'OpenAI', hint: 'gpt-4o-mini recommended' },
          { value: 'anthropic', label: 'Anthropic', hint: 'claude-3-haiku' },
          { value: 'openrouter', label: 'OpenRouter', hint: 'multi-provider' },
          { value: 'custom', label: 'Custom endpoint', hint: 'OpenAI-compatible' },
          { value: 'disable', label: 'Disable LLM', hint: 'free heuristic mode' },
        ],
      });
      if (p.isCancel(provider)) continue;

      if (provider === 'disable') {
        config.llm = undefined;
        saveConfig(config);
        p.log.success('LLM mode disabled.');
        continue;
      }

      const apiKey = await p.password({ message: 'Enter API key:' });
      if (p.isCancel(apiKey) || !apiKey) continue;

      let defaultModel = 'gpt-4o-mini';
      if (provider === 'anthropic') defaultModel = 'claude-3-haiku-20240307';

      let baseUrl: string | undefined;
      if (provider === 'custom') {
        const url = await p.text({
          message: 'Base URL (OpenAI-compatible):',
          placeholder: 'http://localhost:11434/v1',
        });
        if (p.isCancel(url)) continue;
        if (url) baseUrl = url;
      }

      const customModel = await p.text({
        message: 'Model name:',
        placeholder: defaultModel,
        defaultValue: defaultModel,
      });
      if (p.isCancel(customModel)) continue;

      config.llm = {
        provider: provider === 'custom' ? 'openai' : provider,
        apiKey,
        model: customModel || defaultModel,
        baseUrl,
      };
      saveConfig(config);
      p.log.success(`LLM configured: ${config.llm.model}`);
      continue;
    }

    if (section === 'embedding') {
      const embedding = await p.select({
        message: 'Select embedding provider:',
        options: [
          { value: 'off', label: 'Off (default)', hint: 'BM25 fulltext only' },
          { value: 'api', label: 'API (recommended)', hint: 'OpenAI-compatible' },
          { value: 'fastembed', label: 'FastEmbed', hint: 'local ONNX' },
          { value: 'transformers', label: 'Transformers', hint: 'local JS/WASM' },
        ],
      });
      if (p.isCancel(embedding)) continue;

      if (embedding === 'api') {
        const apiKey = await p.password({ message: 'Embedding API key (empty = reuse LLM key):' });
        if (p.isCancel(apiKey)) continue;

        const baseUrl = await p.text({
          message: 'Base URL:',
          placeholder: 'https://api.openai.com/v1',
          defaultValue: '',
        });
        if (p.isCancel(baseUrl)) continue;

        const model = await p.select({
          message: 'Embedding model:',
          options: [
            { value: 'text-embedding-3-small', label: 'text-embedding-3-small' },
            { value: 'text-embedding-3-large', label: 'text-embedding-3-large' },
            { value: 'custom', label: 'Custom model' },
          ],
        });
        if (p.isCancel(model)) continue;

        let modelName: string = model;
        if (model === 'custom') {
          const name = await p.text({ message: 'Model name:', placeholder: 'BAAI/bge-m3' });
          if (p.isCancel(name) || !name) continue;
          modelName = name;
        }

        config.embedding = 'api';
        config.embeddingApi = {
          apiKey: apiKey || undefined,
          baseUrl: baseUrl || undefined,
          model: modelName,
        };
        saveConfig(config);
        p.log.success(`API embedding configured: ${modelName}`);
        continue;
      }

      config.embedding = embedding;
      delete config.embeddingApi;
      saveConfig(config);
      p.log.success(`Embedding set to: ${embedding}`);
      continue;
    }

    if (section === 'behavior') {
      const current = config.behavior ?? {};
      const sessionInject = await p.select({
        message: `Session injection (current: ${current.sessionInject ?? 'minimal'})`,
        options: [
          { value: 'full', label: 'Full' },
          { value: 'minimal', label: 'Minimal (default)' },
          { value: 'silent', label: 'Silent' },
        ],
      });
      if (p.isCancel(sessionInject)) continue;

      config.behavior = { ...current, sessionInject };
      saveConfig(config);
      p.log.success('Behavior settings saved.');
    }
  }
}

// ── Cleanup ────────────────────────────────────────────────────

export async function runCleanupInline(): Promise<void> {
  const action = await p.select({
    message: 'Cleanup options:',
    options: [
      { value: 'project-artifacts', label: 'Uninstall project artifacts', hint: 'remove hook files' },
      { value: 'project-memory', label: 'Purge project memory', hint: 'delete current project memories' },
      { value: 'all-memory', label: 'Purge all memory', hint: '⚠️ delete ALL memories' },
      { value: 'back', label: '← Back', hint: 'return to workbench' },
    ],
  });

  if (p.isCancel(action) || action === 'back') return;

  switch (action) {
    case 'project-artifacts': {
      const m = await import('../commands/uninstall-project-artifacts.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
    case 'project-memory': {
      const m = await import('../commands/purge-project-memory.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
    case 'all-memory': {
      const m = await import('../commands/purge-all-memory.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
  }
}

// ── Ingest ─────────────────────────────────────────────────────

export async function runIngestInline(): Promise<void> {
  const action = await p.select({
    message: 'Git → Memory:',
    options: [
      { value: 'commit', label: 'Ingest commit', hint: 'single commit → memory' },
      { value: 'log', label: 'Ingest log', hint: 'batch recent commits → memories' },
      { value: 'git-hook', label: 'Install git hook', hint: 'auto-capture on every commit' },
      { value: 'git-hook-uninstall', label: 'Uninstall git hook' },
      { value: 'back', label: '← Back', hint: 'return to workbench' },
    ],
  });

  if (p.isCancel(action) || action === 'back') return;

  switch (action) {
    case 'commit': {
      const m = await import('../commands/ingest-commit.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
    case 'log': {
      const m = await import('../commands/ingest-log.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
    case 'git-hook': {
      const m = await import('../commands/git-hook-install.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
    case 'git-hook-uninstall': {
      const m = await import('../commands/git-hook-uninstall.js');
      await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
      break;
    }
  }
}
