import { defineCommand } from 'citty';
import { startSession, endSession, getSessionContext, listSessions } from '../../memory/session.js';
import { AGENT_TYPE_ROLE_MAP } from '../../team/team-store.js';
import { computeWatermark } from '../../team/poll.js';
import { withFreshIndex } from '../../memory/freshness.js';
import { getAllObservations } from '../../memory/observations.js';
import { getObservationStore } from '../../store/obs-store.js';
import { emitError, emitResult, getCliProjectContext, parsePositiveInt } from './operator-shared.js';

export default defineCommand({
  meta: {
    name: 'session',
    description: 'Manage coding sessions from the CLI operator surface',
  },
  args: {
    agent: { type: 'string', description: 'Agent/client name (for example codex or windsurf)' },
    agentType: { type: 'string', description: 'Stable agent type used for role mapping' },
    instanceId: { type: 'string', description: 'Stable instance identity across restarts' },
    role: { type: 'string', description: 'Explicit role override for auto-registration' },
    sessionId: { type: 'string', description: 'Custom session ID (optional)' },
    summary: { type: 'string', description: 'Structured session summary for session end' },
    limit: { type: 'string', description: 'How many recent sessions to include' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const action = (args._ as string[])?.[0] || '';
    const asJson = !!args.json;

    try {
      const { project, dataDir, teamStore } = await getCliProjectContext();

      switch (action) {
        case 'start': {
          const result = await startSession(dataDir, project.id, {
            sessionId: args.sessionId as string | undefined,
            agent: args.agent as string | undefined,
          });

          let agentRecord: ReturnType<typeof teamStore.registerAgent> | null = null;
          const agentType = (args.agentType as string | undefined) || (args.agent as string | undefined);
          if (args.agent || agentType) {
            const resolvedType = agentType || 'unknown';
            const resolvedRole =
              (args.role as string | undefined) ||
              AGENT_TYPE_ROLE_MAP[resolvedType] ||
              'engineer';
            agentRecord = teamStore.registerAgent({
              projectId: project.id,
              agentType: resolvedType,
              instanceId: args.instanceId as string | undefined,
              name: (args.agent as string | undefined) || agentType,
              role: resolvedRole,
            });
          }

          let watermark = computeWatermark(0, 0, 0);
          let rescuedAgentIds: string[] = [];
          let availableTasks = 0;

          if (agentRecord) {
            const lastSeen = agentRecord.last_seen_obs_generation;
            const store = getObservationStore();
            const currentGen = store.getGeneration();
            const projectObs = await withFreshIndex(() =>
              getAllObservations().filter(
                (obs) => obs.projectId === project.id && (obs.writeGeneration ?? 0) > lastSeen,
              ),
            );
            watermark = computeWatermark(lastSeen, currentGen, projectObs.length);
            teamStore.updateWatermark(agentRecord.agent_id, currentGen);
            rescuedAgentIds = teamStore.detectAndMarkStale(project.id, 5 * 60 * 1000);
            availableTasks = teamStore.listTasks(project.id, { available: true }).length;
          }

          const payload = {
            project,
            session: result.session,
            agent: agentRecord
              ? {
                  agentId: agentRecord.agent_id,
                  instanceId: agentRecord.instance_id,
                  name: agentRecord.name,
                  agentType: agentRecord.agent_type,
                  role: agentRecord.role,
                }
              : null,
            watermark,
            rescue: {
              staleAgents: rescuedAgentIds,
              availableTasks,
            },
            previousContext: result.previousContext,
          };

          const textLines = [
            `Session started: ${result.session.id}`,
            `Project: ${project.name} (${project.id})`,
            agentRecord
              ? `Agent: ${agentRecord.name} [${agentRecord.agent_type}] as ${agentRecord.role} (${agentRecord.agent_id})`
              : '',
            watermark.newObservationCount > 0
              ? `${watermark.newObservationCount} new observation(s) since your last session`
              : 'No unseen observations since your last session',
            rescuedAgentIds.length > 0
              ? `Rescued ${rescuedAgentIds.length} stale agent(s)`
              : '',
            availableTasks > 0 ? `${availableTasks} task(s) available to claim` : '',
            '',
            result.previousContext || 'No previous session context found.',
          ].filter(Boolean);

          emitResult(payload, textLines.join('\n'), asJson);
          return;
        }

        case 'end': {
          const sessionId = args.sessionId as string | undefined;
          if (!sessionId) {
            emitError('sessionId is required for "memorix session end"', asJson);
            return;
          }
          const session = await endSession(dataDir, sessionId, args.summary as string | undefined);
          if (!session) {
            emitError(`Session "${sessionId}" not found`, asJson);
            return;
          }
          emitResult(
            { project, session },
            `Session completed: ${session.id}`,
            asJson,
          );
          return;
        }

        case 'context': {
          const limit = parsePositiveInt(args.limit as string | undefined, 3);
          const [context, sessions] = await Promise.all([
            getSessionContext(dataDir, project.id, limit),
            listSessions(dataDir, project.id),
          ]);
          const active = sessions.filter((session) => session.status === 'active').length;
          const completed = sessions.filter((session) => session.status === 'completed').length;
          emitResult(
            {
              project,
              stats: { active, completed, total: sessions.length },
              context,
            },
            [`Session stats: ${active} active / ${completed} completed`, '', context || 'No prior session context.'].join('\n'),
            asJson,
          );
          return;
        }

        default:
          console.log('Memorix Session Commands');
          console.log('');
          console.log('Usage:');
          console.log('  memorix session start [--agent codex --agentType codex --instanceId abc]');
          console.log('  memorix session end --sessionId <id> [--summary "..."]');
          console.log('  memorix session context [--limit 3]');
          console.log('');
          console.log('Options:');
          console.log('  --json              Emit JSON output');
          console.log('  --role <role>       Override default role during session auto-registration');
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
