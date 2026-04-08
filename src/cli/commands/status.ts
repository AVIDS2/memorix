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
  run: async () => {
    const { detectProject } = await import('../../project/detector.js');
    const { RulesSyncer } = await import('../../rules/syncer.js');
    const { getProjectDataDir } = await import('../../store/persistence.js');
    const { getEmbeddingProvider } = await import('../../embedding/provider.js');
    const { existsSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');

    p.intro('memorix status');

    const project = detectProject();
    if (!project) {
      p.log.error('Memorix requires a git repo to establish project identity. Run `git init` in this workspace first.');
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
      const obsFile = join(dataDir, 'observations.json');
      if (existsSync(obsFile)) {
        const data = JSON.parse(readFileSync(obsFile, 'utf-8')) as Array<{ projectId?: string; status?: string }>;
        if (Array.isArray(data)) {
          const projectObs = data.filter(o => o.projectId === project.id);
          obsCount = projectObs.length;
          activeCount = projectObs.filter(o => (o.status ?? 'active') === 'active').length;
        }
      }
    } catch { /* ignore */ }

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

    // Embedding / vector search status
    let embeddingStatus = 'None (fulltext/BM25 only)';
    let embeddingHint = '';
    const embeddingMode = process.env.MEMORIX_EMBEDDING?.toLowerCase()?.trim() || 'off';
    try {
      const provider = await getEmbeddingProvider();
      if (provider) {
        embeddingStatus = `${provider.name} (${provider.dimensions}d)`;
        if (embeddingMode === 'api') {
          const model = process.env.MEMORIX_EMBEDDING_MODEL || 'text-embedding-3-small';
          embeddingHint = `\n  API: ${model}`;
        }
      } else {
        if (embeddingMode === 'api') {
          embeddingHint = '\n  WARN: API embedding configured but failed to connect — check API key/URL';
        } else {
          embeddingHint = '\n  Hint: Set MEMORIX_EMBEDDING=api for best quality, or install fastembed for local';
        }
      }
    } catch {
      embeddingHint = '\n  Hint: Set MEMORIX_EMBEDDING=api for best quality, or install fastembed for local';
    }

    p.note(
      `Search:    BM25 fulltext (Orama)\n` +
      `Embedding: ${embeddingStatus}${embeddingHint}`,
      'Search Engine',
    );

    // ── Config Provenance Diagnostics ──
    // Shows WHERE each config value comes from (the key "排错" improvement)
    try {
      const { loadYamlConfig } = await import('../../config/yaml-loader.js');
      const { loadFileConfig } = await import('../../config.js');
      const { getLoadedEnvFiles } = await import('../../config/dotenv-loader.js');
      const os = await import('node:os');
      const yml = loadYamlConfig(project.rootPath);
      const legacy = loadFileConfig();

      const diagLines: string[] = [];

      // File existence check
      const projectYml = join(project.rootPath, 'memorix.yml');
      const userYml = join(os.homedir(), '.memorix', 'memorix.yml');
      const projectEnv = join(project.rootPath, '.env');
      const userEnv = join(os.homedir(), '.memorix', '.env');
      const legacyJson = join(os.homedir(), '.memorix', 'config.json');

      diagLines.push('Config files:');
      diagLines.push(`  memorix.yml (project): ${existsSync(projectYml) ? '✅ ' + projectYml : '❌ not found'}`);
      diagLines.push(`  memorix.yml (user):    ${existsSync(userYml) ? '✅ ' + userYml : '— not found'}`);
      diagLines.push(`  .env (project):        ${existsSync(projectEnv) ? '✅ ' + projectEnv : '— not found'}`);
      diagLines.push(`  .env (user):           ${existsSync(userEnv) ? '✅ ' + userEnv : '— not found'}`);
      diagLines.push(`  config.json (legacy):  ${existsSync(legacyJson) ? '⚠️  ' + legacyJson : '— not found'}`);
      const loadedEnv = getLoadedEnvFiles();
      if (loadedEnv.length > 0) {
        diagLines.push(`  Loaded .env files:     ${loadedEnv.join(', ')}`);
      }

      // Config value provenance
      diagLines.push('');
      diagLines.push('Active config values:');

      // LLM
      const llmProvider = process.env.MEMORIX_LLM_PROVIDER || yml.llm?.provider || legacy.llm?.provider;
      if (llmProvider) {
        const src = process.env.MEMORIX_LLM_PROVIDER ? 'env' : yml.llm?.provider ? 'memorix.yml' : 'config.json';
        diagLines.push(`  LLM provider:  ${llmProvider} (← ${src})`);
      }
      const llmModel = process.env.MEMORIX_LLM_MODEL || yml.llm?.model || legacy.llm?.model;
      if (llmModel) {
        const src = process.env.MEMORIX_LLM_MODEL ? 'env' : yml.llm?.model ? 'memorix.yml' : 'config.json';
        diagLines.push(`  LLM model:     ${llmModel} (← ${src})`);
      }
      const llmKey =
        process.env.MEMORIX_LLM_API_KEY ||
        process.env.MEMORIX_API_KEY ||
        yml.llm?.apiKey ||
        legacy.llm?.apiKey ||
        process.env.OPENAI_API_KEY;
      if (llmKey) {
        let src = 'unknown';
        if (process.env.MEMORIX_LLM_API_KEY) src = 'env:MEMORIX_LLM_API_KEY';
        else if (process.env.MEMORIX_API_KEY) src = 'env:MEMORIX_API_KEY';
        else if (yml.llm?.apiKey) src = 'memorix.yml (consider moving to .env)';
        else if (legacy.llm?.apiKey) src = 'config.json (legacy)';
        else if (process.env.OPENAI_API_KEY) src = 'env:OPENAI_API_KEY';
        diagLines.push(`  LLM API key:   ${'*'.repeat(8)}...${llmKey.slice(-4)} (← ${src})`);
      } else {
        diagLines.push(`  LLM API key:   not set`);
      }

      // Embedding
      const embMode = process.env.MEMORIX_EMBEDDING || yml.embedding?.provider || legacy.embedding || 'off';
      const embSrc =
        process.env.MEMORIX_EMBEDDING ? 'env' : yml.embedding?.provider ? 'memorix.yml' : legacy.embedding ? 'config.json' : 'default';
      diagLines.push(`  Embedding:     ${embMode} (← ${embSrc})`);

      // Git
      diagLines.push(`  Git autoHook:  ${yml.git?.autoHook ?? false} (← ${yml.git?.autoHook !== undefined ? 'memorix.yml' : 'default'})`);
      diagLines.push(`  Git noise:     skipMerge=${yml.git?.skipMergeCommits ?? true}, excludePatterns=${(yml.git?.excludePatterns ?? []).length}, noiseKeywords=${(yml.git?.noiseKeywords ?? []).length}`);

      // Behavior
      if (yml.behavior?.formationMode) {
        diagLines.push(`  Formation:     ${yml.behavior.formationMode} (← memorix.yml)`);
      }
      if (yml.behavior?.sessionInject) {
        diagLines.push(`  Session inject: ${yml.behavior.sessionInject} (← memorix.yml)`);
      }

      // Git hook status (worktree-safe)
      try {
        const { resolveHooksDir } = await import('../../git/hooks-path.js');
        const resolved = resolveHooksDir(project.rootPath);
        if (resolved && existsSync(resolved.hookPath)) {
          const hookContent = readFileSync(resolved.hookPath, 'utf-8');
          if (hookContent.includes('# [memorix-git-hook]')) {
            diagLines.push(`  Git hook:      installed ✅`);
          } else {
            diagLines.push(`  Git hook:      not installed (run "memorix git-hook")`);
          }
        } else if (!yml.git?.autoHook) {
          diagLines.push(`  Git hook:      not installed (run "memorix git-hook")`);
        }
      } catch { /* best effort */ }

      if (!existsSync(projectYml)) {
        diagLines.push('');
        diagLines.push('💡 Run "memorix init" to create memorix.yml + .env');
      }

      p.note(diagLines.join('\n'), 'Configuration Diagnostics');
    } catch { /* best effort */ }

    const syncer = new RulesSyncer(project.rootPath);
    const status = await syncer.syncStatus();

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
        p.log.warn(`  → ${c.reason}`);
      }
    }

    if (status.totalRules === 0) {
      p.log.info('No rule files found. Create .cursorrules, CLAUDE.md, or .windsurfrules to get started.');
    }

    // Count by source
    try {
      const obsFile = join(dataDir, 'observations.json');
      if (existsSync(obsFile)) {
        const allObs = JSON.parse(readFileSync(obsFile, 'utf-8')) as Array<{ source?: string; type?: string }>;
        const gitCount = allObs.filter(o => o.source === 'git').length;
        const reasoningCount = allObs.filter(o => o.type === 'reasoning').length;
        if (gitCount > 0 || reasoningCount > 0) {
          const parts: string[] = [];
          if (gitCount > 0) parts.push(`Git memories: ${gitCount}`);
          if (reasoningCount > 0) parts.push(`Reasoning traces: ${reasoningCount}`);
          p.note(parts.join('\n'), 'Memory Sources');
        }
      }
    } catch { /* best effort */ }

    p.outro('Done');
  },
});
