import { defineCommand } from 'citty';
import { emitError, emitResult, getCliProjectContext, shortId } from './operator-shared.js';

export default defineCommand({
  meta: {
    name: 'lock',
    description: 'Acquire, release, and inspect advisory team file locks',
  },
  args: {
    file: { type: 'string', description: 'File path to lock or inspect' },
    agentId: { type: 'string', description: 'Agent ID acquiring or releasing the lock' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const action = (args._ as string[])?.[0] || '';
    const asJson = !!args.json;

    try {
      const { project, teamStore } = await getCliProjectContext();

      switch (action) {
        case 'lock': {
          if (!args.file || !args.agentId) {
            emitError('file and agentId are required for "memorix lock lock"', asJson);
            return;
          }
          const result = teamStore.acquireLock(project.id, args.file as string, args.agentId as string);
          if (!result.success) {
            emitError(`File is already locked by ${shortId(result.lockedBy)}`, asJson);
            return;
          }
          emitResult(
            { project, file: args.file, lockedBy: args.agentId },
            `Locked: ${args.file as string}`,
            asJson,
          );
          return;
        }

        case 'unlock': {
          if (!args.file || !args.agentId) {
            emitError('file and agentId are required for "memorix lock unlock"', asJson);
            return;
          }
          const released = teamStore.releaseLock(project.id, args.file as string, args.agentId as string);
          if (!released) {
            emitError('Cannot unlock: not the owner or the file is not locked', asJson);
            return;
          }
          emitResult(
            { project, file: args.file, released: true },
            `Unlocked: ${args.file as string}`,
            asJson,
          );
          return;
        }

        case 'status': {
          if (args.file) {
            const lock = teamStore.getLockStatus(project.id, args.file as string);
            emitResult(
              { project, lock },
              lock
                ? `Locked by ${teamStore.getAgent(lock.locked_by)?.name ?? shortId(lock.locked_by)}: ${args.file as string}`
                : `Unlocked: ${args.file as string}`,
              asJson,
            );
            return;
          }

          const locks = teamStore.listLocks(project.id, args.agentId as string | undefined);
          emitResult(
            { project, locks },
            locks.length === 0
              ? 'No active file locks.'
              : locks
                  .map((lock) => `- ${lock.file} -> ${teamStore.getAgent(lock.locked_by)?.name ?? shortId(lock.locked_by)}`)
                  .join('\n'),
            asJson,
          );
          return;
        }

        default:
          console.log('Memorix Lock Commands');
          console.log('');
          console.log('Usage:');
          console.log('  memorix lock lock --file src/app.ts --agentId <id>');
          console.log('  memorix lock unlock --file src/app.ts --agentId <id>');
          console.log('  memorix lock status [--file src/app.ts] [--agentId <id>]');
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
