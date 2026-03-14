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
  },
  run: async ({ args }) => {
    const os = await import('node:os');
    let cwd: string;
    try { cwd = process.cwd(); } catch { cwd = os.homedir(); }

    const ref = args.ref || 'HEAD';

    p.intro(`Ingest commit: ${ref}`);

    try {
      const { getCommitInfo, ingestCommit } = await import('../../git/extractor.js');
      const commit = getCommitInfo(cwd, ref);
      const result = ingestCommit(commit);

      // Show what will be stored
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

      // Confirm
      const confirmed = await p.confirm({
        message: 'Store this commit as memory?',
      });

      if (p.isCancel(confirmed) || !confirmed) {
        p.outro('Ingest cancelled.');
        return;
      }

      // Store via memorix_store logic
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

      p.outro(`Memory stored from commit ${commit.shortHash}.`);
    } catch (err) {
      console.error(`Failed to ingest commit: ${err}`);
      p.outro('Ingest failed. Make sure you are in a git repository.');
    }
  },
});
