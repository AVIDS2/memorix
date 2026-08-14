/**
 * CLI Command: memorix purge
 *
 * Retire memories from retrieval. Project-scoped by default; --all covers
 * every project. Observations and long-term records are archived (never
 * hard-deleted) so the audit trail survives. Refuses to run outside a
 * terminal without --yes.
 */

import { defineCommand } from 'citty';
import { detectProject } from '../../project/detector.js';
import { getProjectDataDir } from '../../store/persistence.js';

export default defineCommand({
  meta: {
    name: 'purge',
    description: 'Retire memories from retrieval (current project by default, --all for every project)',
  },
  args: {
    all: {
      type: 'boolean',
      description: 'Purge every project instead of the current one',
      default: false,
    },
    yes: {
      type: 'boolean',
      description: 'Skip the interactive confirmation',
      default: false,
    },
    json: {
      type: 'boolean',
      description: 'Emit a machine-readable result',
      default: false,
    },
  },
  async run({ args }) {
    const purgeAll = Boolean(args.all);
    const yes = Boolean(args.yes);
    const asJson = Boolean(args.json);

    // Confirmation gate first: a destructive wipe never proceeds in a
    // non-interactive shell without an explicit --yes.
    if (!yes && !process.stdin.isTTY) {
      console.error('[ERROR] Non-interactive environment. Add --yes to confirm.');
      console.error('[ERROR] Refusing to purge memories without confirmation.');
      process.exitCode = 1;
      return;
    }
    if (!yes) {
      const readline = await import('node:readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const question = purgeAll
        ? 'Retire ALL memories from every project? (y/N) '
        : 'Retire all memories for this project? (y/N) ';
      const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
      rl.close();
      if (answer.trim().toLowerCase() !== 'y') {
        console.log('Cancelled.');
        return;
      }
    }

    let projectId: string | null = null;
    if (!purgeAll) {
      const project = detectProject();
      if (!project) {
        console.error('[ERROR] No .git found — run from a project directory or pass --all.');
        process.exitCode = 1;
        return;
      }
      projectId = project.id;
    }

    const dataDir = await getProjectDataDir(projectId ?? '');
    const { initObservationStore } = await import('../../store/obs-store.js');
    const { getAllObservations, resolveObservations } = await import('../../memory/observations.js');
    const { withFreshIndex } = await import('../../memory/freshness.js');
    await initObservationStore(dataDir);

    const observations = await withFreshIndex(() => getAllObservations());
    const target = purgeAll ? observations : observations.filter((o) => o.projectId === projectId);
    const ids = target
      .map((o) => o.id)
      .filter((id): id is number => typeof id === 'number');
    const archived = ids.length > 0
      ? (await resolveObservations(ids, 'archived')).resolved.length
      : 0;

    const { LongTermMemoryStore } = await import('../../memory/long-term-store.js');
    const { archiveLongTermMemory } = await import('../../memory/long-term.js');
    const longTermStore = new LongTermMemoryStore();
    await longTermStore.init(dataDir);
    let longTermArchived = 0;
    for (const memory of longTermStore.list()) {
      if (memory.state === 'archived' || memory.state === 'superseded') continue;
      if (!purgeAll && memory.originProjectId !== projectId) continue;
      try {
        await archiveLongTermMemory({
          dataDir,
          id: memory.id,
          reason: purgeAll ? 'purge --all' : 'purge (project) ' + (projectId ?? ''),
        });
        longTermArchived += 1;
      } catch { /* already inactive */ }
    }

    const result = {
      scope: purgeAll ? 'all' : projectId,
      observationsArchived: archived,
      longTermArchived,
    };
    if (asJson) {
      console.log(JSON.stringify(result));
    } else {
      console.log(
        `[OK] Purged ${purgeAll ? 'all projects' : result.scope}: archived ${archived} observations and ${longTermArchived} long-term memories.`,
      );
    }
  },
});
