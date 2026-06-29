import { defineCommand } from 'citty';
import { CodeGraphStore } from '../../codegraph/store.js';
import { buildProjectContextExplain, formatProjectContextExplain } from '../../codegraph/project-context.js';
import { getAllObservations } from '../../memory/observations.js';
import { emitError, emitResult, getCliProjectContext } from './operator-shared.js';

export default defineCommand({
  meta: {
    name: 'explain',
    description: 'Explain where Memorix project context comes from',
  },
  args: {
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const asJson = !!args.json;

    try {
      const { project, dataDir } = await getCliProjectContext();
      const store = new CodeGraphStore();
      await store.init(dataDir);
      const observations = getAllObservations();
      const explain = buildProjectContextExplain({ project, store, observations });

      emitResult({ project, explain }, formatProjectContextExplain(explain), asJson);
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
