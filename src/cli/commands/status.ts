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
      p.log.error('No .git found — not a project directory. Run "git init" first.');
      return;
    }
    const dataDir = await getProjectDataDir(project.id);

    // Count observations
    let obsCount = 0;
    try {
      const obsFile = join(dataDir, 'observations.json');
      if (existsSync(obsFile)) {
        const data = JSON.parse(readFileSync(obsFile, 'utf-8'));
        obsCount = Array.isArray(data) ? data.length : 0;
      }
    } catch { /* ignore */ }

    p.note(
      [
        `Name:         ${project.name}`,
        `ID:           ${project.id}`,
        `Root:         ${project.rootPath}`,
        `Git remote:   ${project.gitRemote || 'none'}`,
        `Data dir:     ${dataDir}`,
        `Observations: ${obsCount}`,
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

    // memorix.yml config status
    try {
      const { loadYamlConfig } = await import('../../config/yaml-loader.js');
      const yml = loadYamlConfig(project.rootPath);
      const ymlParts: string[] = [];

      // Check file locations
      const projectYml = join(project.rootPath, 'memorix.yml');
      const userYml = join((await import('node:os')).homedir(), '.memorix', 'memorix.yml');
      if (existsSync(projectYml)) ymlParts.push(`Project:   ${projectYml}`);
      if (existsSync(userYml)) ymlParts.push(`User:      ${userYml}`);
      if (ymlParts.length === 0) ymlParts.push('Not found  (run "memorix init" to create)');

      if (yml.llm?.provider) ymlParts.push(`LLM:       ${yml.llm.provider}/${yml.llm.model ?? 'default'}`);
      if (yml.embedding?.provider && yml.embedding.provider !== 'off') ymlParts.push(`Embedding: ${yml.embedding.provider}/${yml.embedding.model ?? 'default'}`);
      if (yml.git?.autoHook) ymlParts.push(`Git hook:  auto-install enabled`);
      if (yml.behavior?.formationMode) ymlParts.push(`Formation: ${yml.behavior.formationMode}`);

      // Git hook status
      const hookPath = join(project.rootPath, '.git', 'hooks', 'post-commit');
      if (existsSync(hookPath)) {
        const hookContent = readFileSync(hookPath, 'utf-8');
        if (hookContent.includes('# [memorix-git-hook]')) {
          ymlParts.push(`Git hook:  installed ✅`);
        }
      } else if (!yml.git?.autoHook) {
        ymlParts.push(`Git hook:  not installed (run "memorix git-hook")`);
      }

      p.note(ymlParts.join('\n'), 'Configuration');
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
