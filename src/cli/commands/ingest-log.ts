/**
 * CLI Command: memorix ingest log
 *
 * Batch ingest recent git commits as memories.
 * This is the Git→Memory direction — unique to Memorix.
 */

import { defineCommand } from 'citty';
import * as p from '@clack/prompts';

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
      const commits = getRecentCommits(cwd, count);

      if (commits.length === 0) {
        console.log('No commits found.');
        p.outro('Nothing to ingest.');
        return;
      }

      // Show commits
      console.log('');
      console.log(`Found ${commits.length} commits:`);
      console.log('');
      for (const commit of commits) {
        console.log(`  ${commit.shortHash} ${commit.subject}`);
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

      const project = detectProject(cwd);
      if (!project) {
        p.log.error('No .git found — not a project directory.');
        return;
      }
      const dataDir = await getProjectDataDir(project.id);
      await initObservations(dataDir);

      let stored = 0;
      let skipped = 0;

      for (const commit of commits) {
        try {
          const result = ingestCommit(commit);
          await storeObservation({
            entityName: result.entityName,
            type: result.type as any,
            title: result.title,
            narrative: result.narrative,
            facts: result.facts,
            concepts: result.concepts,
            filesModified: result.filesModified,
            projectId: project.id,
          });
          stored++;
          console.log(`  ✅ ${commit.shortHash} ${commit.subject}`);
        } catch {
          skipped++;
          console.log(`  ⏭️ ${commit.shortHash} (skipped)`);
        }
      }

      p.outro(`Ingested ${stored} commits, skipped ${skipped}.`);
    } catch (err) {
      console.error(`Failed to ingest log: ${err}`);
      p.outro('Ingest failed. Make sure you are in a git repository.');
    }
  },
});
