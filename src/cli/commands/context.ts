import { defineCommand } from 'citty';
import { CodeGraphStore } from '../../codegraph/store.js';
import { buildProjectContextOverview, formatProjectContextOverview } from '../../codegraph/project-context.js';
import { getAllObservations } from '../../memory/observations.js';
import { emitError, emitResult, getCliProjectContext } from './operator-shared.js';

export default defineCommand({
  meta: {
    name: 'context',
    description: 'Show the current project context Memorix can safely use',
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
      const overview = buildProjectContextOverview({ project, store, observations });

      emitResult({ project, overview }, formatProjectContextOverview(overview), asJson);
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
