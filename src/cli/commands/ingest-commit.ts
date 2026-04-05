/**
 * CLI Command: memorix ingest commit
 *
 * Extract engineering knowledge from a git commit and store as memory.
 * This is the Git→Memory direction — unique to Memorix.
 */

import { defineCommand } from 'citty';
import * as p from '@clack/prompts';

export default defineCommand({
  meta: {
    name: 'commit',
    description: 'Ingest a git commit as memory',
  },
  args: {
    ref: {
      type: 'string',
      description: 'Commit ref (default: HEAD)',
      required: false,
    },
    auto: {
      type: 'boolean',
      description: 'Non-interactive mode (used by git post-commit hook)',
      required: false,
    },
    force: {
      type: 'boolean',
      description: 'Bypass Git noise filter and ingest anyway',
      required: false,
    },
  },
  run: async ({ args }) => {
    const os = await import('node:os');
    let cwd: string;
    try { cwd = process.cwd(); } catch { cwd = os.homedir(); }

    const ref = args.ref || 'HEAD';
    const auto = !!args.auto;
    const force = !!args.force;

    if (!auto) p.intro(`Ingest commit: ${ref}`);

    try {
      const { getCommitInfo, ingestCommit } = await import('../../git/extractor.js');
      const commit = getCommitInfo(cwd, ref);

      // Noise filter: skip low-value commits (typo, format, lockfile, merge, etc.)
      const { shouldFilterCommit } = await import('../../git/noise-filter.js');
      const { getGitConfig } = await import('../../config.js');
      const gitCfg = getGitConfig();
      const filterResult = shouldFilterCommit(commit, {
        skipMergeCommits: gitCfg.skipMergeCommits,
        excludePatterns: gitCfg.excludePatterns,
        noiseKeywords: gitCfg.noiseKeywords,
      });
      if (filterResult.skip && !force) {
        if (auto) {
          console.error(`[memorix] Skipped ${commit.shortHash}: ${filterResult.reason}`);
          process.exit(0);
        } else {
          p.log.warn(`Commit ${commit.shortHash} filtered as noise: ${filterResult.reason}`);
          p.outro('Use --force to override the noise filter.');
        }
        return;
      }

      const result = ingestCommit(commit);

      // Store via memorix_store logic
      const { initObservations, storeObservation } = await import('../../memory/observations.js');
      const { getProjectDataDir } = await import('../../store/persistence.js');
      const { detectProject } = await import('../../project/detector.js');
      const { initObservationStore, getObservationStore: getStore } = await import('../../store/obs-store.js');

      const project = detectProject(cwd);
      if (!project) {
        if (!auto) p.log.error('No .git found — not a project directory.');
        return;
      }
      const dataDir = await getProjectDataDir(project.id);
      await initObservationStore(dataDir);
      await initObservations(dataDir);

      // Dedup: skip if this commit hash was already ingested
      const existingObs = await getStore().loadAll() as Array<{ commitHash?: string }>;
      if (existingObs.some(o => o.commitHash === commit.hash)) {
        if (!auto) p.log.warn(`Commit ${commit.shortHash} already ingested. Skipping.`);
        if (auto) process.exit(0);
        return;
      }

      if (!auto) {
        // Interactive: show details and confirm
        console.log('');
        console.log(`Commit: ${commit.shortHash} — ${commit.subject}`);
        console.log(`Author: ${commit.author} @ ${commit.date}`);
        console.log(`Files:  ${commit.filesChanged.length} changed (+${commit.insertions}/-${commit.deletions})`);
        console.log('');
        console.log(`Entity: ${result.entityName}`);
        console.log(`Type:   ${result.type}`);
        console.log(`Title:  ${result.title}`);
        console.log('');
        console.log('Facts:');
        for (const fact of result.facts) {
          console.log(`  - ${fact}`);
        }
        if (result.concepts.length > 0) {
          console.log(`Concepts: ${result.concepts.join(', ')}`);
        }
        console.log('');

        const confirmed = await p.confirm({
          message: 'Store this commit as memory?',
        });

        if (p.isCancel(confirmed) || !confirmed) {
          p.outro('Ingest cancelled.');
          return;
        }
      }

      await storeObservation({
        entityName: result.entityName,
        type: result.type as any,
        title: result.title,
        sourceDetail: 'git-ingest',
        narrative: result.narrative,
        facts: result.facts,
        concepts: result.concepts,
        filesModified: result.filesModified,
        projectId: project.id,
        source: 'git',
        commitHash: commit.hash,
      });

      if (auto) {
        console.error(`[memorix] Git memory: ${commit.shortHash} — ${commit.subject}`);
        process.exit(0);
      } else {
        p.outro(`Memory stored from commit ${commit.shortHash}.`);
      }
    } catch (err) {
      if (auto) {
        console.error(`[memorix] Git hook ingest failed: ${err}`);
        process.exit(1);
      } else {
        console.error(`Failed to ingest commit: ${err}`);
        p.outro('Ingest failed. Make sure you are in a git repository.');
      }
    }
  },
});
