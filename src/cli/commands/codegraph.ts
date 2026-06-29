import { defineCommand } from 'citty';
import { CodeGraphStore } from '../../codegraph/store.js';
import { indexProjectLite } from '../../codegraph/lite-provider.js';
import { assembleContextPackForTask, buildContextPackPrompt } from '../../codegraph/context-pack.js';
import { backfillMissingObservationCodeRefs } from '../../codegraph/binder.js';
import { getAllObservations } from '../../memory/observations.js';
import { emitError, emitResult, getCliProjectContext, parsePositiveInt } from './operator-shared.js';

function formatStatus(status: ReturnType<CodeGraphStore['status']>): string {
  return [
    `CodeGraph Memory: ${status.provider}`,
    `- Files: ${status.files}`,
    `- Symbols: ${status.symbols}`,
    `- Edges: ${status.edges}`,
    `- Memory refs: ${status.refs}`,
    status.indexedAt ? `- Indexed at: ${status.indexedAt}` : '- Indexed at: never',
  ].join('\n');
}

export default defineCommand({
  meta: {
    name: 'codegraph',
    description: 'Inspect and refresh CodeGraph Memory for the current project',
  },
  args: {
    action: { type: 'string', description: 'Action: status, refresh, or context-pack' },
    task: { type: 'string', description: 'Task text for context-pack' },
    limit: { type: 'string', description: 'Max active memories to inspect for context-pack' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const positional = (args._ as string[]) ?? [];
    const action = (positional[0] || (args.action as string | undefined) || 'status').toLowerCase();
    const asJson = !!args.json;

    try {
      const { project, dataDir } = await getCliProjectContext();
      const store = new CodeGraphStore();
      await store.init(dataDir);

      switch (action) {
        case 'status': {
          const status = store.status(project.id);
          emitResult({ project, status }, formatStatus(status), asJson);
          return;
        }

        case 'refresh': {
          const indexed = await indexProjectLite({
            projectId: project.id,
            projectRoot: project.rootPath,
          });
          store.replaceProjectIndex(project.id, indexed);
          const activeObservations = getAllObservations()
            .filter(obs => obs.projectId === project.id && (obs.status ?? 'active') === 'active');
          const backfill = await backfillMissingObservationCodeRefs(store, activeObservations);
          const status = store.status(project.id);
          emitResult(
            { project, status, backfill },
            [
              'CodeGraph Memory refreshed.',
              formatStatus(status),
              `- Backfilled memories: ${backfill.observationsBackfilled}`,
              `- Backfilled refs: ${backfill.refsBackfilled}`,
            ].join('\n'),
            asJson,
          );
          return;
        }

        case 'context-pack': {
          const task = (args.task as string | undefined)?.trim() || positional.slice(1).join(' ').trim();
          if (!task) {
            emitError('task is required for "memorix codegraph context-pack"', asJson);
            return;
          }
          const limit = parsePositiveInt(args.limit as string | undefined, 20);
          const observations = getAllObservations()
            .filter(obs => obs.projectId === project.id && (obs.status ?? 'active') === 'active')
            .reverse();
          const pack = assembleContextPackForTask({
            store,
            projectId: project.id,
            task,
            observations,
            limit,
          });
          emitResult({ project, pack }, buildContextPackPrompt(pack), asJson);
          return;
        }

        default:
          emitError(`unknown codegraph action "${action}". Use "status", "refresh", or "context-pack".`, asJson);
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
