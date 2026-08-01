/**
 * memorix status — Show project info + rules sync status
 */

import { defineCommand } from 'citty';
import * as p from '@clack/prompts';

export default defineCommand({
  meta: {
    name: 'status',
    description: 'Show project info and rules sync status',
  },
  args: {
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const asJson = !!args.json;
    const { detectProject } = await import('../../project/detector.js');
    const { RulesSyncer } = await import('../../rules/syncer.js');
    const { getProjectDataDir } = await import('../../store/persistence.js');
    const { getEmbeddingProvider } = await import('../../embedding/provider.js');
    const { getResolvedConfig, getResolvedAgentLane } = await import('../../config/resolved-config.js');
    const { existsSync, readFileSync } = await import('node:fs');

    const project = detectProject();
    if (!project) {
      const message = 'Memorix requires a git repo to establish project identity. Run `git init` in this workspace first.';
      if (asJson) {
        console.log(JSON.stringify({
          ok: false,
          error: { code: 'NO_GIT_REPOSITORY', message },
        }, null, 2));
      } else {
        p.intro('memorix status');
        p.log.error(message);
      }
      return;
    }

    // Load .env BEFORE any process.env reads or provider initialization (#46)
    const { loadDotenv } = await import('../../config/dotenv-loader.js');
    loadDotenv(project.rootPath);

    const dataDir = await getProjectDataDir(project.id);

    // Count observations for the CURRENT project only (not global total)
    let obsCount = 0;
    let activeCount = 0;
    try {
      const { initObservationStore, getObservationStore } = await import('../../store/obs-store.js');
      await initObservationStore(dataDir);
      const store = getObservationStore();
      const { filterReadableObservations } = await import('../../memory/visibility.js');
      const projectObs = filterReadableObservations(await store.loadAll(), { projectId: project.id });
      obsCount = projectObs.length;
      activeCount = projectObs.filter(o => (o.status ?? 'active') === 'active').length;
    } catch { /* ignore */ }

    // Embedding / vector search status
    let embeddingStatus = 'None (fulltext/BM25 only)';
    let embeddingHint = '';
    let embeddingProvider: { name: string; dimensions: number } | null = null;
    const embeddingMode = process.env.MEMORIX_EMBEDDING?.toLowerCase()?.trim() || 'off';
    try {
      const provider = await getEmbeddingProvider();
      if (provider) {
        embeddingProvider = provider;
        embeddingStatus = `${provider.name} (${provider.dimensions}d)`;
        if (embeddingMode === 'api') {
          const model = process.env.MEMORIX_EMBEDDING_MODEL || 'text-embedding-3-small';
          embeddingHint = `\n  API: ${model}`;
        }
      } else {
        if (embeddingMode === 'api') {
          embeddingHint = '\n  WARN: API embedding configured but failed to connect — check API key/URL';
        } else {
          embeddingHint = '\n  Hint: Set MEMORIX_EMBEDDING=api for best quality, or install @huggingface/transformers or fastembed for local';
        }
      }
    } catch {
      embeddingHint = '\n  Hint: Set MEMORIX_EMBEDDING=api for best quality, or install @huggingface/transformers or fastembed for local';
    }

    // ── TOML-first Config Snapshot ──
    let configuration: Record<string, unknown> | null = null;
    let configNote: string | null = null;
    try {
      const { getLoadedEnvFiles } = await import('../../config/dotenv-loader.js');
      const resolved = getResolvedConfig({ projectRoot: project.rootPath });
      const agent = getResolvedAgentLane({ projectRoot: project.rootPath });
      const diagLines: string[] = [];
      diagLines.push('Active config sources:');
      diagLines.push(`  TOML:        ${formatSourceList(resolved.sources.toml)}`);
      diagLines.push(`  Compatibility: ${formatSourceList(resolved.sources.legacy)}`);
      const loadedEnv = getLoadedEnvFiles();
      if (loadedEnv.length > 0) {
        diagLines.push(`  Loaded .env: ${loadedEnv.join(', ')}`);
      }
      if (resolved.sources.env.length > 0) {
        diagLines.push(`  Env overrides: ${resolved.sources.env.join(', ')}`);
      }
      diagLines.push('');
      diagLines.push('Resolved lanes:');
      diagLines.push(`  Agent lane:      ${formatLane(agent.provider, agent.model, agent.baseUrl, agent.apiKey)}`);
      diagLines.push(`  Memory LLM lane: ${formatLane(resolved.memory.llm.provider, resolved.memory.llm.model, resolved.memory.llm.baseUrl, resolved.memory.llm.apiKey)}`);
      diagLines.push(`  Embedding lane:  ${formatLane(resolved.embedding.provider, resolved.embedding.model, resolved.embedding.baseUrl, resolved.embedding.apiKey)}`);
      diagLines.push(`  Memory behavior: inject=${resolved.memory.inject ?? 'default'}, formation=${resolved.memory.formation ?? 'default'}, autoCleanup=${resolved.memory.autoCleanup ?? 'default'}`);
      diagLines.push(`  Git behavior:    autoHook=${resolved.git.autoHook ?? 'default'}, ingestOnCommit=${resolved.git.ingestOnCommit ?? 'default'}, maxDiffSize=${resolved.git.maxDiffSize ?? 'default'}, skipMergeCommits=${resolved.git.skipMergeCommits ?? 'default'}`);
      diagLines.push(`  Server:          transport=${resolved.server.transport ?? 'default'}, dashboard=${resolved.server.dashboard ?? 'default'}, dashboardPort=${resolved.server.dashboardPort ?? 'default'}`);

      // Git hook status (worktree-safe)
      try {
        const { resolveHooksDir } = await import('../../git/hooks-path.js');
        const resolved = resolveHooksDir(project.rootPath);
        if (resolved && existsSync(resolved.hookPath)) {
          const hookContent = readFileSync(resolved.hookPath, 'utf-8');
          if (hookContent.includes('# [memorix-git-hook]')) {
            diagLines.push(`  Git hook:      installed [OK]`);
          } else {
            diagLines.push(`  Git hook:      not installed (run "memorix git-hook")`);
          }
        } else {
          diagLines.push(`  Git hook:      not installed (run "memorix git-hook")`);
        }
      } catch { /* best effort */ }

      if (resolved.sources.toml.length === 0) {
        diagLines.push('');
        diagLines.push('[TIP] Run "memorix init" to create TOML config');
      }

      configNote = diagLines.join('\n');
      configuration = {
        sources: {
          toml: resolved.sources.toml,
          compatibility: resolved.sources.legacy,
          dotenv: loadedEnv,
          environment: resolved.sources.env,
        },
        lanes: {
          agent: summarizeLane(agent.provider, agent.model, agent.baseUrl, agent.apiKey),
          memoryLlm: summarizeLane(resolved.memory.llm.provider, resolved.memory.llm.model, resolved.memory.llm.baseUrl, resolved.memory.llm.apiKey),
          embedding: summarizeLane(resolved.embedding.provider, resolved.embedding.model, resolved.embedding.baseUrl, resolved.embedding.apiKey),
        },
        memory: {
          inject: resolved.memory.inject ?? 'default',
          formation: resolved.memory.formation ?? 'default',
          autoCleanup: resolved.memory.autoCleanup ?? 'default',
        },
        git: {
          autoHook: resolved.git.autoHook ?? 'default',
          ingestOnCommit: resolved.git.ingestOnCommit ?? 'default',
          maxDiffSize: resolved.git.maxDiffSize ?? 'default',
          skipMergeCommits: resolved.git.skipMergeCommits ?? 'default',
        },
        server: {
          transport: resolved.server.transport ?? 'default',
          dashboard: resolved.server.dashboard ?? 'default',
          dashboardPort: resolved.server.dashboardPort ?? 'default',
        },
      };
    } catch { /* best effort */ }

    const syncer = new RulesSyncer(project.rootPath);
    const status = await syncer.syncStatus();

    // Count by source
    const memorySources: string[] = [];
    try {
      const { initObservationStore, getObservationStore } = await import('../../store/obs-store.js');
      await initObservationStore(dataDir);
      const store = getObservationStore();
      const { filterReadableObservations } = await import('../../memory/visibility.js');
      const allObs = filterReadableObservations(await store.loadAll(), { projectId: project.id });
      const gitCount = allObs.filter(o => o.source === 'git').length;
      const reasoningCount = allObs.filter(o => o.type === 'reasoning').length;
      if (gitCount > 0 || reasoningCount > 0) {
        if (gitCount > 0) memorySources.push(`Git memories: ${gitCount}`);
        if (reasoningCount > 0) memorySources.push(`Reasoning traces: ${reasoningCount}`);
      }
    } catch { /* best effort */ }

    if (asJson) {
      console.log(JSON.stringify({
        ok: true,
        project: {
          name: project.name,
          id: project.id,
          rootPath: project.rootPath,
          gitRemote: project.gitRemote ?? null,
          dataDir,
        },
        observations: { total: obsCount, active: activeCount },
        search: {
          fulltext: 'orama-bm25',
          embedding: {
            mode: embeddingMode,
            available: embeddingProvider !== null,
            provider: embeddingProvider?.name ?? null,
            dimensions: embeddingProvider?.dimensions ?? null,
            status: embeddingStatus,
            hint: embeddingHint.trim() || null,
          },
        },
        configuration,
        rules: {
          sources: status.sources,
          total: status.totalRules,
          unique: status.uniqueRules,
          conflicts: status.conflicts.map((conflict) => ({
            left: { source: conflict.ruleA.source, id: conflict.ruleA.id },
            right: { source: conflict.ruleB.source, id: conflict.ruleB.id },
            reason: conflict.reason,
          })),
        },
        memorySources,
      }, null, 2));
      return;
    }

    p.intro('memorix status');
    p.note(
      [
        `Name:         ${project.name}`,
        `ID:           ${project.id}`,
        `Root:         ${project.rootPath}`,
        `Git remote:   ${project.gitRemote || 'none'}`,
        `Data dir:     ${dataDir}`,
        `Observations: ${obsCount} (${activeCount} active)`,
      ].join('\n'),
      'Project',
    );
    p.note(
      `Search:    BM25 fulltext (Orama)\n` +
      `Embedding: ${embeddingStatus}${embeddingHint}`,
      'Search Engine',
    );
    if (configNote) p.note(configNote, 'Configuration');
    p.note(
      [
        `Sources:      ${status.sources.join(', ') || 'none detected'}`,
        `Total rules:  ${status.totalRules}`,
        `Unique rules: ${status.uniqueRules}`,
        `Conflicts:    ${status.conflicts.length}`,
      ].join('\n'),
      'Rules Sync',
    );

    if (status.conflicts.length > 0) {
      p.log.warn('Conflicts detected:');
      for (const c of status.conflicts) {
        p.log.warn(`  ${c.ruleA.source}:${c.ruleA.id} vs ${c.ruleB.source}:${c.ruleB.id}`);
        p.log.warn(`  -> ${c.reason}`);
      }
    }

    if (status.totalRules === 0) {
      p.log.info('No rule files found. Create .cursorrules, CLAUDE.md, or .windsurfrules to get started.');
    }

    if (memorySources.length > 0) p.note(memorySources.join('\n'), 'Memory Sources');

    p.outro('Done');
  },
});

function formatSourceList(paths: string[]): string {
  return paths.length > 0 ? paths.join(', ') : 'none';
}

function formatLane(provider?: string, model?: string, baseUrl?: string, apiKey?: string): string {
  const parts = [
    provider ?? 'unset',
    model ?? 'unset',
  ];
  if (baseUrl) parts.push(`baseUrl=${baseUrl}`);
  parts.push(`apiKey=${apiKey ? '<redacted>' : 'not set'}`);
  return parts.join(' / ');
}

function summarizeLane(provider?: string, model?: string, baseUrl?: string, apiKey?: string): Record<string, string | boolean | null> {
  return {
    provider: provider ?? null,
    model: model ?? null,
    baseUrl: baseUrl ?? null,
    apiKeyConfigured: Boolean(apiKey),
  };
}
