import { defineCommand } from 'citty';
import {
  buildAutoProjectContext,
  formatAutoProjectContextPrompt,
  type AutoContextRefreshMode,
} from '../../codegraph/auto-context.js';
import { getAllObservations } from '../../memory/observations.js';
import { emitError, emitResult, getCliProjectContext } from './operator-shared.js';

function coerceRefreshMode(input?: string): AutoContextRefreshMode {
  const value = (input ?? 'auto').trim().toLowerCase();
  if (value === 'always' || value === 'never' || value === 'auto') return value;
  throw new Error('refresh must be one of: auto, always, never');
}

export default defineCommand({
  meta: {
    name: 'context',
    description: 'Show the Memory Autopilot brief for the current project',
  },
  args: {
    task: { type: 'string', description: 'Current task for context shaping' },
    refresh: { type: 'string', description: 'Project scan policy: auto, always, or never' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const asJson = !!args.json;

    try {
      const { project, dataDir } = await getCliProjectContext();
      const context = await buildAutoProjectContext({
        project,
        dataDir,
        observations: getAllObservations(),
        task: args.task as string | undefined,
        refresh: coerceRefreshMode(args.refresh as string | undefined),
      });

      emitResult(
        {
          project,
          overview: context.overview,
          refresh: context.refresh,
          ...(context.task ? { task: context.task } : {}),
        },
        formatAutoProjectContextPrompt(context),
        asJson,
      );
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
