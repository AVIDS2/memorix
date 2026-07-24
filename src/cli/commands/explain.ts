import { defineCommand } from 'citty';
import { buildAutoProjectContext, type AutoContextRefreshMode } from '../../codegraph/auto-context.js';
import { formatProjectContextExplain } from '../../codegraph/project-context.js';
import { formatContextReceipt } from '../../knowledge/context-assembly.js';
import { getAllObservations } from '../../memory/observations.js';
import { emitError, emitResult, getCliProjectContext } from './operator-shared.js';

function coerceRefreshMode(input?: string): AutoContextRefreshMode {
  const value = (input ?? 'auto').trim().toLowerCase();
  if (value === 'always' || value === 'never' || value === 'auto') return value;
  throw new Error('refresh must be one of: auto, always, never');
}

export default defineCommand({
  meta: {
    name: 'explain',
    description: 'Explain where Memorix project context comes from',
  },
  args: {
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
        refresh: coerceRefreshMode(args.refresh as string | undefined),
      });

      emitResult(
        { project, explain: context.explain, receipt: context.workset.receipt, refresh: context.refresh },
        formatProjectContextExplain(context.explain) + '\n\n' + formatContextReceipt(context.workset.receipt),
        asJson,
      );
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
