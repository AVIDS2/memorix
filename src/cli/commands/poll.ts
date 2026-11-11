import { defineCommand } from 'citty';
import { computePoll, computeWatermark } from '../../team/poll.js';
import { getObservationStore } from '../../store/obs-store.js';
import { getAllObservations } from '../../memory/observations.js';
import { withFreshIndex } from '../../memory/freshness.js';
import { filterReadableObservations } from '../../memory/visibility.js';
import { emitError, emitResult, getCliProjectContext, resolveCliActorId, shortId } from './operator-shared.js';

export default defineCommand({
  meta: {
    name: 'poll',
    description: 'Get a full project coordination snapshot for an agent',
  },
  args: {
    agentId: { type: 'string', description: 'Agent ID for personalized situational awareness' },
    markInboxRead: { type: 'boolean', description: 'Mark all inbox messages as read after returning them' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const asJson = !!args.json;

    try {
      const { project, teamStore, identity, reader: activeReader } = await getCliProjectContext();
      const agentId = resolveCliActorId(args.agentId, identity);
      let reader = activeReader;

      let watermark = computeWatermark(0, 0, 0);
      if (agentId) {
        const agent = teamStore.getAgent(agentId);
        if (!agent || agent.project_id !== project.id) {
          emitError(`Unknown agent "${agentId}"`, asJson);
          return;
        }
        reader = {
          projectId: project.id,
          agentId,
          isTeamMember: agent.status === 'active',
        };

        const lastSeen = agent.last_seen_obs_generation;
        const currentGen = getObservationStore().getGeneration();
        const projectObs = await withFreshIndex(() =>
          filterReadableObservations(
            getAllObservations().filter(
              (obs) => obs.projectId === project.id && (obs.writeGeneration ?? 0) > lastSeen,
            ),
            reader,
          ),
        );
        watermark = computeWatermark(lastSeen, currentGen, projectObs.length);
        teamStore.updateWatermark(agentId, currentGen);
        teamStore.heartbeat(agentId);
      }

      const poll = computePoll(teamStore, project.id, agentId ?? null, watermark);
      if (args.markInboxRead && agentId) {
        teamStore.markAllRead(project.id, agentId);
      }

      const text = [
        poll.agent ? `You: ${shortId(poll.agent.agentId)} (${poll.agent.status})` : 'Project-level overview',
        poll.watermark.newObservationCount > 0
          ? `${poll.watermark.newObservationCount} new observation(s)`
          : 'No unseen observations',
        poll.inbox.unreadCount > 0 ? `${poll.inbox.unreadCount} unread message(s)` : 'Inbox clear',
        poll.tasks.myInProgress.length > 0
          ? `${poll.tasks.myInProgress.length} in-progress task(s)`
          : 'No in-progress tasks',
        poll.tasks.availableToClaim.length > 0
          ? `${poll.tasks.availableToClaim.length} task(s) available to claim`
          : 'No claimable tasks',
        `Team: ${poll.team.activeAgents.length} active / ${poll.team.totalAgents} total`,
      ].join('\n');

      emitResult({ project, poll }, text, asJson);
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
