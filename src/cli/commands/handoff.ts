import { defineCommand } from 'citty';
import { storeObservation } from '../../memory/observations.js';
import { createHandoffArtifact } from '../../team/handoff.js';
import { emitError, emitResult, getCliProjectContext, parseCsvList, shortId } from './operator-shared.js';

export default defineCommand({
  meta: {
    name: 'handoff',
    description: 'Create structured handoff artifacts between agents',
  },
  args: {
    fromAgentId: { type: 'string', description: 'Sender agent ID' },
    toAgentId: { type: 'string', description: 'Optional recipient agent ID' },
    taskId: { type: 'string', description: 'Optional related task ID' },
    summary: { type: 'string', description: 'Human-readable summary of the handoff' },
    context: { type: 'string', description: 'Detailed machine-readable context for the next agent' },
    filesModified: { type: 'string', description: 'Comma-separated file list' },
    concepts: { type: 'string', description: 'Comma-separated discoverability concepts' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const action = (args._ as string[])?.[0] || '';
    const asJson = !!args.json;

    try {
      const { project, teamStore } = await getCliProjectContext();

      switch (action) {
        case 'send': {
          if (!args.fromAgentId || !args.summary || !args.context) {
            emitError('fromAgentId, summary, and context are required for "memorix handoff send"', asJson);
            return;
          }
          const result = await createHandoffArtifact(
            {
              projectId: project.id,
              fromAgentId: args.fromAgentId as string,
              toAgentId: args.toAgentId as string | undefined,
              taskId: args.taskId as string | undefined,
              summary: args.summary as string,
              context: args.context as string,
              filesModified: parseCsvList(args.filesModified as string | undefined),
              concepts: parseCsvList(args.concepts as string | undefined),
            },
            storeObservation,
            teamStore,
          );
          emitResult(
            { project, handoff: result },
            `Handoff created: observation #${result.observationId} from ${shortId(result.fromAgentId)}${result.toAgentId ? ` to ${shortId(result.toAgentId)}` : ' (broadcast)'}`,
            asJson,
          );
          return;
        }

        default:
          console.log('Memorix Handoff Commands');
          console.log('');
          console.log('Usage:');
          console.log('  memorix handoff send --fromAgentId <id> --summary "..." --context "..." [--toAgentId <id>] [--taskId <id>]');
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
