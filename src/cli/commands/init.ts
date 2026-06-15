/**
 * CLI Command: memorix init
 *
 * Interactive generator for TOML configuration.
 * Supports both machine-level defaults and project-level overrides.
 */

import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  getEnvTemplateTarget,
  getInitConfigFilename,
  getInitProjectConfigFilename,
  getInitScopeDescription,
  getInitTargetDir,
  resolveInitScope,
  shouldOfferDotenv,
  type InitScope,
} from './init-shared.js';

type InitLlmProvider = 'none' | 'openai' | 'anthropic' | 'openrouter' | 'custom';
type InitEmbeddingProvider = 'off' | 'api' | 'fastembed';
type InitInjectMode = 'minimal' | 'full' | 'silent';

export default defineCommand({
  meta: {
    name: 'init',
    description: 'Initialize Memorix TOML configuration',
  },
  args: {
    global: {
      type: 'boolean',
      description: 'Create global defaults under ~/.memorix',
      required: false,
    },
    project: {
      type: 'boolean',
      description: 'Create project-level overrides in the current repository',
      required: false,
    },
  },
  run: async ({ args }) => {
    p.intro('Initialize Memorix Configuration');

    let selectedScope: InitScope | undefined;
    if (!args.global && !args.project) {
      const scope = await p.select({
        message: 'Where should Memorix start from?',
        options: [
          {
            value: 'global',
            label: 'Global defaults',
            hint: 'recommended for solo or multi-project workflows',
          },
          {
            value: 'project',
            label: 'Project config',
            hint: 'recommended when this repository needs shared overrides',
          },
        ],
      });
      if (p.isCancel(scope)) {
        p.outro('Cancelled.');
        return;
      }
      selectedScope = scope;
    }

    let scope: InitScope;
    try {
      scope = resolveInitScope(args, selectedScope);
    } catch (error) {
      p.log.error(error instanceof Error ? error.message : String(error));
      p.outro('Cancelled.');
      return;
    }

    const isGlobal = scope === 'global';
    const targetDir = getInitTargetDir(scope, process.cwd(), homedir());
    const targetPath = path.join(targetDir, isGlobal ? getInitConfigFilename() : getInitProjectConfigFilename());
    const envPath = path.join(targetDir, '.env');

    p.log.info(getInitScopeDescription(scope));

    if (existsSync(targetPath)) {
      const overwrite = await p.confirm({
        message: `${targetPath} already exists. Overwrite it?`,
        initialValue: false,
      });
      if (p.isCancel(overwrite) || !overwrite) {
        p.outro('Cancelled.');
        return;
      }
    }

    const llmProvider = await p.select({
      message: 'LLM provider (for smart dedup and fact extraction):',
      options: [
        { value: 'none', label: 'None', hint: 'free heuristic mode' },
        { value: 'openai', label: 'OpenAI', hint: 'gpt-4o-mini' },
        { value: 'anthropic', label: 'Anthropic', hint: 'claude-3-haiku' },
        { value: 'openrouter', label: 'OpenRouter', hint: 'multi-provider' },
        { value: 'custom', label: 'Custom', hint: 'OpenAI-compatible endpoint' },
      ],
    });
    if (p.isCancel(llmProvider)) {
      p.outro('Cancelled.');
      return;
    }

    const embeddingProvider = await p.select({
      message: 'Embedding provider (for semantic search):',
      options: [
        { value: 'off', label: 'Off', hint: 'BM25 fulltext only' },
        { value: 'api', label: 'API', hint: 'OpenAI-compatible, best quality' },
        { value: 'fastembed', label: 'FastEmbed', hint: 'local ONNX' },
      ],
    });
    if (p.isCancel(embeddingProvider)) {
      p.outro('Cancelled.');
      return;
    }

    const gitAutoHook = await p.confirm({
      message: 'Enable Git post-commit memory capture by default?',
      initialValue: false,
    });
    if (p.isCancel(gitAutoHook)) {
      p.outro('Cancelled.');
      return;
    }

    const sessionInject = await p.select({
      message: 'Session start injection mode:',
      options: [
        { value: 'minimal', label: 'Minimal', hint: 'one-line hint (default)' },
        { value: 'full', label: 'Full', hint: 'inject top memories' },
        { value: 'silent', label: 'Silent', hint: 'no automatic injection' },
      ],
    });
    if (p.isCancel(sessionInject)) {
      p.outro('Cancelled.');
      return;
    }

    const tomlContent = buildInitTomlConfig({
      scope,
      llmProvider: llmProvider as InitLlmProvider,
      embeddingProvider: embeddingProvider as InitEmbeddingProvider,
      gitAutoHook: Boolean(gitAutoHook),
      sessionInject: sessionInject as InitInjectMode,
    });

    const envLines: string[] = [
      '# Memorix compatibility environment variables',
      '# Prefer ~/.memorix/config.toml or <git-root>/memorix.toml for normal setup.',
      '',
    ];

    if (llmProvider !== 'none') {
      envLines.push('# LLM API key');
      if (llmProvider === 'openai' || llmProvider === 'custom') {
        envLines.push('MEMORIX_LLM_API_KEY=sk-your-key-here');
      } else if (llmProvider === 'anthropic') {
        envLines.push('MEMORIX_LLM_API_KEY=sk-ant-your-key-here');
      } else if (llmProvider === 'openrouter') {
        envLines.push('MEMORIX_LLM_API_KEY=sk-or-your-key-here');
      }
      if (llmProvider === 'custom') {
        envLines.push('# MEMORIX_LLM_BASE_URL=http://localhost:11434/v1');
      }
      envLines.push('');
    }

    if (embeddingProvider === 'api') {
      envLines.push('# Embedding API key');
      envLines.push('# Independent from MEMORIX_LLM_API_KEY; use your embedding provider key here.');
      envLines.push('# MEMORIX_EMBEDDING_API_KEY=sk-your-key-here');
      envLines.push('# MEMORIX_EMBEDDING_BASE_URL=https://api.openai.com/v1');
      envLines.push('');
    }

    envLines.push('# Optional memory LLM simple key (does not apply to embedding or agent lanes)');
    envLines.push('# MEMORIX_API_KEY=sk-your-key-here');
    envLines.push('');
    envLines.push('# Compatibility variables (lowest priority)');
    envLines.push('# OPENAI_API_KEY=sk-...');
    envLines.push('# ANTHROPIC_API_KEY=sk-ant-...');
    envLines.push('# OPENROUTER_API_KEY=sk-or-...');
    envLines.push('');

    mkdirSync(targetDir, { recursive: true });
    writeFileSync(targetPath, tomlContent, 'utf-8');
    p.log.success(`Created ${targetPath}`);

    if (shouldOfferDotenv(scope)) {
      const envExamplePath = getEnvTemplateTarget(targetDir, {
        hasDotenvExample: existsSync(path.join(targetDir, '.env.example')),
      });
      const envContent = envLines.join('\n');
      if (existsSync(envExamplePath)) {
        const overwriteEnvTemplate = await p.confirm({
          message: `${envExamplePath} already exists. Overwrite it?`,
          initialValue: false,
        });
        if (p.isCancel(overwriteEnvTemplate) || !overwriteEnvTemplate) {
          p.outro('Cancelled.');
          return;
        }
      }
      writeFileSync(envExamplePath, envContent, 'utf-8');
      p.log.success(`Created ${envExamplePath}`);

      const createEnv = !existsSync(envPath)
        ? await p.confirm({
          message: `Create .env from ${path.basename(envExamplePath)} now? (you can fill in keys later)`,
          initialValue: true,
        })
        : false;
      if (!p.isCancel(createEnv) && createEnv) {
        writeFileSync(envPath, envContent, 'utf-8');
        p.log.success(`Created ${envPath}`);
      }
    }

    console.log('');
    p.log.info('Primary config:');
    p.log.info(`  ${targetPath}`);
    if (isGlobal) {
      p.log.info('Project-level memorix.toml can override these defaults later.');
    } else {
      p.log.info('This project config will override any global defaults on this machine.');
    }
    if (gitAutoHook) {
      p.log.info('Git post-commit hook will auto-install on the next MCP server start.');
    }

    p.outro(isGlobal
      ? 'Done! Global defaults are ready. Restart your MCP server to apply.'
      : 'Done! Project overrides are ready. Restart your MCP server to apply.');
  },
});

export function buildInitTomlConfig(options: {
  scope: InitScope;
  llmProvider: InitLlmProvider;
  embeddingProvider: InitEmbeddingProvider;
  gitAutoHook: boolean;
  sessionInject: InitInjectMode;
  date?: string;
}): string {
  const isGlobal = options.scope === 'global';
  const lines: string[] = [
    '# Memorix configuration',
    '#',
    '# Primary user-facing config lives in TOML. Legacy YAML/.env files are still read for compatibility.',
    `# Generated by: memorix init${isGlobal ? ' --global' : ' --project'}`,
    `# Date: ${options.date ?? new Date().toISOString().split('T')[0]}`,
    '#',
    isGlobal
      ? '# Global config may store local credentials because it stays outside project git.'
      : '# Project config should not store credentials. Keep credentials in global config or launcher secrets.',
    '',
  ];

  lines.push('[agent]');
  lines.push('# Optional memcode coding-agent lane.');
  lines.push('# Leave unset to use memcode login/model settings or the memory.llm fallback.');
  lines.push('# provider = "deepseek"');
  lines.push('# model = "deepseek-chat"');
  lines.push('# base_url = "https://api.deepseek.com/v1"');
  if (isGlobal) {
    lines.push('# api_key = "..."');
  }
  lines.push('');

  if (options.llmProvider !== 'none') {
    lines.push('[memory.llm]');
    lines.push(`provider = "${options.llmProvider === 'custom' ? 'openai' : options.llmProvider}"`);
    if (options.llmProvider === 'openai') {
      lines.push('model = "gpt-4o-mini"');
    } else if (options.llmProvider === 'anthropic') {
      lines.push('model = "claude-3-haiku-20240307"');
    } else if (options.llmProvider === 'openrouter') {
      lines.push('# model = "openai/gpt-4o-mini"');
    }
    if (options.llmProvider === 'custom') {
      lines.push('# OpenAI-compatible endpoint, for example DashScope, DeepSeek, Ollama, or an internal gateway.');
      lines.push('# model = "your-model-name"');
      lines.push('# base_url = "https://your-provider.example/v1"');
    }
    if (isGlobal) {
      lines.push('# api_key = "..."');
    }
    lines.push('');
  }

  lines.push('[embedding]');
  lines.push(`provider = "${options.embeddingProvider}"`);
  if (options.embeddingProvider === 'api') {
    lines.push('# OpenAI-compatible embedding endpoint. This key is independent from memory.llm and agent.');
    lines.push('# model = "text-embedding-3-small"');
    lines.push('# base_url = "https://api.openai.com/v1"');
    if (isGlobal) {
      lines.push('# api_key = "..."');
    }
  }
  lines.push('');

  lines.push('[git]');
  lines.push(`auto_hook = ${options.gitAutoHook}`);
  lines.push('ingest_on_commit = true');
  lines.push('max_diff_size = 500');
  lines.push('skip_merge_commits = true');
  lines.push('# exclude_patterns = ["*.lock", "dist/**"]');
  lines.push('');

  lines.push('[memory]');
  lines.push(`inject = "${options.sessionInject}"`);
  lines.push('sync_advisory = true');
  lines.push('auto_cleanup = true');
  lines.push('formation = "active"');
  lines.push('');

  lines.push('[server]');
  lines.push('transport = "stdio"');
  lines.push('dashboard = true');
  lines.push('dashboard_port = 3210');
  lines.push('');

  return lines.join('\n');
}
