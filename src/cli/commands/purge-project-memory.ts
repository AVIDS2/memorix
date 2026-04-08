/**
 * CLI Command: memorix purge project-memory
 *
 * Delete memories for the current project only.
 */

import { defineCommand } from 'citty';
import * as p from '@clack/prompts';

export default defineCommand({
  meta: {
    name: 'project-memory',
    description: 'Delete memories for current project',
  },
  args: {},
  run: async ({}) => {
    const os = await import('node:os');
    let cwd: string;
    try { cwd = process.cwd(); } catch { cwd = os.homedir(); }

    p.intro('Purge Project Memory');

    // Show what will be deleted
    console.log('');
    console.log('Will delete memories for:');
    console.log(`  Project: ${cwd}`);
    console.log('');
    console.log('This will remove all observations, entities, and relations');
    console.log('associated with this project from the memory database.');
    console.log('');
    console.log('Project artifacts (hook files) will be preserved.');
    console.log('');

    // Confirm
    const confirmed = await p.confirm({
      message: 'Continue purge?',
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.outro('Purge cancelled.');
      return;
    }

    // Get project ID
    const projectId = getProjectId(cwd);

    // Delete project memories
    try {
      const {
        withFreshObservations,
        getProjectObservations,
        resolveObservations,
      } = await import('../../memory/observations.js');
      const observations = await withFreshObservations(() => getProjectObservations(projectId));
      const ids = observations.map((o) => o.id);

      if (ids.length === 0) {
        console.log('No observations found for this project.');
        p.outro('No memories to purge.');
        return;
      }

      const result = await resolveObservations(ids, 'archived');

      console.log(`✅ Archived ${result.resolved.length} observations for project`);

      p.outro(`Project memory purged. ${result.resolved.length} observations archived.`);
    } catch (err) {
      console.error(`❌ Failed to purge project memory: ${err}`);
      p.outro('Purge failed.');
    }
  },
});

function getProjectId(projectRoot: string): string {
  try {
    const { detectProject } = require('../project/detector.js');
    const project = detectProject(projectRoot);
    if (project) return project.id;
  } catch { /* fallback below */ }
  const normalized = projectRoot.replace(/\\/g, '/');
  return `untracked/${normalized}`;
}
