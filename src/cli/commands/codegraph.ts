import { defineCommand } from 'citty';
import { CodeGraphStore } from '../../codegraph/store.js';
import { indexProjectLite } from '../../codegraph/lite-provider.js';
import { emitError, emitResult, getCliProjectContext } from './operator-shared.js';

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
    action: { type: 'string', description: 'Action: status or refresh' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const action = ((args._ as string[])?.[0] || (args.action as string | undefined) || 'status').toLowerCase();
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
          store.upsertFiles(indexed.files);
          store.upsertSymbols(indexed.symbols);
          store.upsertEdges(indexed.edges);
          const status = store.status(project.id);
          emitResult({ project, status }, `CodeGraph Memory refreshed.\n${formatStatus(status)}`, asJson);
          return;
        }

        default:
          emitError(`unknown codegraph action "${action}". Use "status" or "refresh".`, asJson);
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
