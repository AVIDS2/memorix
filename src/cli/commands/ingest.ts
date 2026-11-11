/**
 * CLI Command: memorix ingest
 *
 * Parent command for Git→Memory and image ingestion.
 */

import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'ingest',
    description: 'Ingest engineering knowledge from Git and images',
  },
  subCommands: {
    commit: () => import('./ingest-commit.js').then((module) => module.default),
    log: () => import('./ingest-log.js').then((module) => module.default),
    image: () => import('./ingest-image.js').then((module) => module.default),
  },
  run: async ({ args }) => {
    const action = (args._ as string[])?.[0] || '';
    if (action === 'commit') {
      const module = await import('./ingest-commit.js');
      await module.default.run?.({ args: { ...args, _: [] }, rawArgs: [], cmd: module.default } as any);
      return;
    }
    if (action === 'log') {
      const module = await import('./ingest-log.js');
      await module.default.run?.({ args: { ...args, _: [] }, rawArgs: [], cmd: module.default } as any);
      return;
    }
    if (action === 'image') {
      const module = await import('./ingest-image.js');
      await module.default.run?.({ args: { ...args, _: [] }, rawArgs: [], cmd: module.default } as any);
      return;
    }

    console.log('Memorix Ingest Commands');
    console.log('');
    console.log('Usage:');
    console.log('  memorix ingest commit [--ref HEAD]');
    console.log('  memorix ingest log [--count 10]');
    console.log('  memorix ingest image --path ./diagram.png');
  },
});
