/**
 * CLI Command: memorix purge all-memory
 *
 * Delete ALL memories (dangerous operation).
 */

import { defineCommand } from 'citty';
import * as p from '@clack/prompts';

export default defineCommand({
  meta: {
    name: 'all-memory',
    description: 'Delete ALL memories (dangerous)',
  },
  args: {},
  run: async ({}) => {
    p.intro('⚠️  Purge All Memory');

    // Show warning
    console.log('');
    console.log('⚠️  WARNING: This will delete ALL memories!');
    console.log('');
    console.log('This will remove:');
    console.log('  - All observations from all projects');
    console.log('  - All entities and relations');
    console.log('  - All embeddings');
    console.log('');
    console.log('This action CANNOT be undone.');
    console.log('');
    console.log('Project artifacts (hook files) will be preserved.');
    console.log('');

    // First confirmation
    const confirmed1 = await p.confirm({
      message: 'Are you sure you want to delete ALL memories?',
    });

    if (p.isCancel(confirmed1) || !confirmed1) {
      p.outro('Purge cancelled.');
      return;
    }

    // Second confirmation (type "DELETE" to confirm)
    const confirmed2 = await p.text({
      message: 'Type "DELETE" to confirm:',
      validate: (value) => {
        if (value !== 'DELETE') {
          return 'Please type "DELETE" to confirm';
        }
        return undefined;
      },
    });

    if (p.isCancel(confirmed2) || confirmed2 !== 'DELETE') {
      p.outro('Purge cancelled.');
      return;
    }

    // Delete all memories
    try {
      const {
        withFreshObservations,
        getAllObservations,
        resolveObservations,
      } = await import('../../memory/observations.js');
      const observations = await withFreshObservations(() => getAllObservations());
      const ids = observations.map((o) => o.id);

      if (ids.length === 0) {
        console.log('No observations found.');
        p.outro('No memories to purge.');
        return;
      }

      const result = await resolveObservations(ids, 'archived');

      console.log(`✅ Archived ${result.resolved.length} observations`);

      p.outro(`All memory purged. ${result.resolved.length} observations archived.`);
    } catch (err) {
      console.error(`❌ Failed to purge all memory: ${err}`);
      p.outro('Purge failed.');
    }
  },
});
