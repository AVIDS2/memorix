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

    p.outro('Done');
  },
});
