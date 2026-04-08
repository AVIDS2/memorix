/**
 * CLI Command: memorix ingest log
 *
 * Batch ingest recent git commits as memories.
 * This is the Git→Memory direction — unique to Memorix.
 */

import { defineCommand } from 'citty';
import * as p from '@clack/prompts';

type IngestableCommit = {
  hash: string;
  shortHash: string;
  subject: string;
};

type IngestLogResult = {
  stored: number;
  dupSkipped: number;
  errSkipped: number;
};

/**
 * Shared dedup logic for batch git ingest.
 * Exported so tests can exercise the production path rather than reimplementing it.
 */
export async function ingestCommitsWithDedup<T extends IngestableCommit>(
  commits: T[],
  existingHashes: Set<string>,
  ingestOne: (commit: T) => Promise<void>,
  log: (line: string) => void = console.log,
): Promise<IngestLogResult> {
  let stored = 0;
  let dupSkipped = 0;
  let errSkipped = 0;

  for (const commit of commits) {
    if (existingHashes.has(commit.hash)) {
      dupSkipped++;
      log(`  ⏭️ ${commit.shortHash} ${commit.subject} — already ingested`);
      continue;
    }
    try {
      await ingestOne(commit);
      stored++;
      existingHashes.add(commit.hash);
      log(`  ✅ ${commit.shortHash} ${commit.subject}`);
    } catch (err) {
      errSkipped++;
      const message = err instanceof Error ? err.message : String(err);
      log(`  ⏭️ ${commit.shortHash} ${commit.subject} — error: ${message}`);
    }
  }

  return { stored, dupSkipped, errSkipped };
}

export default defineCommand({
  meta: {
    name: 'log',
    description: 'Batch ingest recent git commits as memories',
  },
  args: {
    count: {
      type: 'string',
      description: 'Number of recent commits to ingest (default: 10)',
      required: false,
    },
  },
  run: async ({ args }) => {
    const os = await import('node:os');
    let cwd: string;
    try { cwd = process.cwd(); } catch { cwd = os.homedir(); }

    const count = parseInt(args.count || '10', 10);

    p.intro(`Ingest recent ${count} commits`);

    try {
      const { getRecentCommits, ingestCommit } = await import('../../git/extractor.js');
      const rawCommits = getRecentCommits(cwd, count);

      if (rawCommits.length === 0) {
        console.log('No commits found.');
        p.outro('Nothing to ingest.');
        return;
      }

      // Apply noise filter
      const { filterCommits } = await import('../../git/noise-filter.js');
      const { getGitConfig } = await import('../../config.js');
      const gitCfg = getGitConfig();
      const { kept: commits, skipped: noiseCommits } = filterCommits(rawCommits, {
        skipMergeCommits: gitCfg.skipMergeCommits,
        excludePatterns: gitCfg.excludePatterns,
        noiseKeywords: gitCfg.noiseKeywords,
      });

      if (commits.length === 0) {
        console.log(`All ${rawCommits.length} commits filtered as noise.`);
        p.outro('Nothing to ingest.');
        return;
      }

      // Show commits
      console.log('');
      console.log(`Found ${rawCommits.length} commits (${noiseCommits.length} filtered as noise):`);
      console.log('');
      for (const commit of commits) {
        console.log(`  ${commit.shortHash} ${commit.subject}`);
      }
      if (noiseCommits.length > 0) {
        console.log('');
        console.log(`  Filtered (noise):`);
        for (const { commit, reason } of noiseCommits) {
          console.log(`  ⏭️ ${commit.shortHash} ${commit.subject} — ${reason}`);
        }
      }
      console.log('');

      // Confirm
      const confirmed = await p.confirm({
        message: `Ingest ${commits.length} commits as memories?`,
      });

      if (p.isCancel(confirmed) || !confirmed) {
        p.outro('Ingest cancelled.');
        return;
      }

      // Store each commit
      const { initObservations, storeObservation } = await import('../../memory/observations.js');
      const { getProjectDataDir } = await import('../../store/persistence.js');
      const { detectProject } = await import('../../project/detector.js');
      const { initObservationStore, getObservationStore: getStore } = await import('../../store/obs-store.js');

      const project = detectProject(cwd);
      if (!project) {
        p.log.error('No .git found — not a project directory.');
        return;
      }
      const dataDir = await getProjectDataDir(project.id);
      await initObservationStore(dataDir);
      await initObservations(dataDir);

      // Dedup: load existing commit hashes to skip already-ingested commits (#48)
      const existingObs = await getStore().loadAll() as Array<{ commitHash?: string }>;
      const existingHashes = new Set(
        existingObs.map(o => o.commitHash).filter((hash): hash is string => typeof hash === 'string' && hash.length > 0),
      );

      const { stored, dupSkipped, errSkipped } = await ingestCommitsWithDedup(
        commits,
        existingHashes,
        async (commit) => {
          const result = ingestCommit(commit);
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
        },
        console.log,
      );

      const parts = [`Ingested ${stored}/${commits.length} commits`];
      if (dupSkipped) parts.push(`${dupSkipped} already stored`);
      if (errSkipped) parts.push(`${errSkipped} errors`);
      p.outro(parts.join(', ') + '.');
    } catch (err) {
      console.error(`Failed to ingest log: ${err}`);
      p.outro('Ingest failed. Make sure you are in a git repository.');
    }
  },
});
