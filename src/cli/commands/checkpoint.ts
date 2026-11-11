import { defineCommand } from 'citty';
import { buildCompactionWorkset } from '../../memory/compaction.js';
import { CompactionCheckpointStore } from '../../store/compaction-checkpoint-store.js';
import type { CompactionCheckpoint } from '../../types.js';
import {
  emitError,
  emitResult,
  getCliProjectContext,
  parsePositiveInt,
  shortId,
} from './operator-shared.js';

async function getCheckpointContext() {
  const context = await getCliProjectContext();
  const { initAliasRegistry, registerAlias } = await import('../../project/aliases.js');
  initAliasRegistry(context.dataDir);
  const canonicalId = await registerAlias(context.project);
  return {
    ...context,
    project: { ...context.project, id: canonicalId },
    store: new CompactionCheckpointStore(context.dataDir),
  };
}

function assertProjectCheckpoint(
  checkpoint: CompactionCheckpoint | undefined,
  projectId: string,
  id: string,
): CompactionCheckpoint {
  if (!checkpoint || checkpoint.projectId !== projectId) {
    throw new Error(`No compact checkpoint "${id}" exists for this project.`);
  }
  return checkpoint;
}

function formatCheckpoint(checkpoint: CompactionCheckpoint): string {
  const completion = checkpoint.completedAt ? `, completed ${checkpoint.completedAt}` : '';
  const delivery = checkpoint.deliveredAt ? `, delivered ${checkpoint.deliveryCount}x` : '';
  return [
    `${shortId(checkpoint.id)} ${checkpoint.phase} ${checkpoint.agent} (${checkpoint.captureKind}, ${checkpoint.reason})`,
    `  session: ${checkpoint.sessionId}`,
    `  source: ${checkpoint.sourceEvent}${completion}${delivery}`,
    `  status: ${checkpoint.status}${checkpoint.transcriptAvailable ? ', transcript marker available' : ''}`,
    ...(checkpoint.summary ? [`  summary: ${checkpoint.summary.replace(/\s+/g, ' ').slice(0, 220)}`] : []),
  ].join('\n');
}

function usage(): void {
  console.log('Memorix Compact Checkpoints');
  console.log('');
  console.log('Usage:');
  console.log('  memorix checkpoint list [--session <id>] [--agent <name>] [--all]');
  console.log('  memorix checkpoint show --id <checkpoint-id>');
  console.log('  memorix checkpoint context [--id <checkpoint-id>] [--task "..."] [--budget 420]');
  console.log('  memorix checkpoint archive --id <checkpoint-id>');
}

export default defineCommand({
  meta: {
    name: 'checkpoint',
    description: 'Inspect and manage native compact continuity checkpoints',
  },
  args: {
    id: { type: 'string', description: 'Checkpoint ID' },
    session: { type: 'string', description: 'Filter by host session ID' },
    agent: { type: 'string', description: 'Filter by host agent name' },
    task: { type: 'string', description: 'Current task for a bounded continuation workset' },
    budget: { type: 'string', description: 'Maximum workset token budget (default: 420)' },
    limit: { type: 'string', description: 'Maximum checkpoints to list (default: 20)' },
    all: { type: 'boolean', description: 'Include archived checkpoints in list output' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const positional = (args._ as string[]) ?? [];
    const action = (positional[0] ?? 'list').toLowerCase();
    const asJson = Boolean(args.json);

    try {
      const { project, store } = await getCheckpointContext();
      const id = (args.id as string | undefined)?.trim();

      switch (action) {
        case 'list': {
          const checkpoints = store.list({
            projectId: project.id,
            sessionId: (args.session as string | undefined)?.trim() || undefined,
            agent: (args.agent as string | undefined)?.trim() || undefined,
            includeArchived: Boolean(args.all),
            limit: parsePositiveInt(args.limit as string | undefined, 20),
          });
          emitResult(
            { project, checkpoints },
            checkpoints.length
              ? checkpoints.map(formatCheckpoint).join('\n\n')
              : 'No compact checkpoints for this project.',
            asJson,
          );
          return;
        }

        case 'show': {
          if (!id) throw new Error('id is required for "memorix checkpoint show".');
          const checkpoint = assertProjectCheckpoint(store.get(id), project.id, id);
          emitResult({ project, checkpoint }, formatCheckpoint(checkpoint), asJson);
          return;
        }

        case 'context': {
          const checkpoint = id
            ? assertProjectCheckpoint(store.get(id), project.id, id)
            : store.list({
              projectId: project.id,
              sessionId: (args.session as string | undefined)?.trim() || undefined,
              agent: (args.agent as string | undefined)?.trim() || undefined,
              limit: parsePositiveInt(args.limit as string | undefined, 20),
            }).find((entry) => entry.phase === 'complete');
          if (!checkpoint) {
            throw new Error('No completed compact checkpoint is available for this project and filter.');
          }
          const workset = buildCompactionWorkset(checkpoint, {
            task: (args.task as string | undefined)?.trim(),
            maxTokens: parsePositiveInt(args.budget as string | undefined, 420),
          });
          emitResult({ project, checkpoint, workset }, workset.text, asJson);
          return;
        }

        case 'archive': {
          if (!id) throw new Error('id is required for "memorix checkpoint archive".');
          assertProjectCheckpoint(store.get(id), project.id, id);
          const checkpoint = store.archive(id);
          if (!checkpoint) throw new Error(`Compact checkpoint "${id}" is already archived.`);
          emitResult({ project, checkpoint }, `Archived compact checkpoint ${shortId(checkpoint.id)}.`, asJson);
          return;
        }

        default:
          usage();
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
