import { defineCommand } from 'citty';
import { AGENT_TYPE_ROLE_MAP } from '../../team/team-store.js';
import { clearCliIdentity, loadCliIdentity, saveCliIdentity } from '../identity.js';
import { emitError, emitResult, getCliProjectContext, parseCsvList } from './operator-shared.js';

function requiredText(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${label} is required`);
  return text;
}

export default defineCommand({
  meta: {
    name: 'identity',
    description: 'Select the explicit CLI actor used for private or team-scoped operations',
  },
  args: {
    agentId: { type: 'string', description: 'Existing active coordination agent ID' },
    agentType: { type: 'string', description: 'Agent type when joining (for example codex)' },
    instanceId: { type: 'string', description: 'Stable instance identity when joining' },
    name: { type: 'string', description: 'Optional display name when joining' },
    role: { type: 'string', description: 'Optional coordination role when joining' },
    capabilities: { type: 'string', description: 'Comma-separated capability list when joining' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const action = ((args._ as string[])?.[0] || 'status').toLowerCase();
    const asJson = !!args.json;

    try {
      const { project, dataDir, teamStore, identity, reader, identityWarning } = await getCliProjectContext();

      switch (action) {
        case 'status': {
          const saved = await loadCliIdentity(dataDir, project.id);
          const agent = saved ? teamStore.getAgent(saved.agentId) : undefined;
          emitResult(
            {
              project,
              identity,
              savedIdentity: saved,
              agent: agent ?? null,
              reader,
              ...(identityWarning ? { warning: identityWarning } : {}),
            },
            identity
              ? `CLI identity: ${agent?.name ?? identity.agentId} (${identity.agentId})`
              : identityWarning ?? 'CLI identity: project-scoped only. Use "memorix identity join" or "memorix identity use --agent-id <id>" for private/team operations.',
            asJson,
          );
          return;
        }

        case 'join': {
          const agentType = requiredText(args.agentType, 'agentType');
          const agent = teamStore.registerAgent({
            projectId: project.id,
            agentType,
            instanceId: args.instanceId as string | undefined,
            name: args.name as string | undefined,
            role: (args.role as string | undefined) || AGENT_TYPE_ROLE_MAP[agentType] || 'engineer',
            capabilities: parseCsvList(args.capabilities as string | undefined),
          });
          const nextIdentity = {
            agentId: agent.agent_id,
            projectId: project.id,
            activatedAt: new Date().toISOString(),
          };
          await saveCliIdentity(dataDir, nextIdentity);
          emitResult(
            { project, identity: nextIdentity, agent },
            `CLI identity activated: ${agent.name} (${agent.agent_id})`,
            asJson,
          );
          return;
        }

        case 'use': {
          const agentId = requiredText(args.agentId, 'agentId');
          const agent = teamStore.getAgent(agentId);
          if (!agent || agent.project_id !== project.id || agent.status !== 'active') {
            emitError('agentId must identify an active coordination member of this project.', asJson);
            return;
          }
          const nextIdentity = {
            agentId: agent.agent_id,
            projectId: project.id,
            activatedAt: new Date().toISOString(),
          };
          await saveCliIdentity(dataDir, nextIdentity);
          emitResult(
            { project, identity: nextIdentity, agent },
            `CLI identity activated: ${agent.name} (${agent.agent_id})`,
            asJson,
          );
          return;
        }

        case 'clear': {
          await clearCliIdentity(dataDir);
          emitResult(
            { project, cleared: true },
            'CLI identity cleared. Subsequent commands use project-scoped access only.',
            asJson,
          );
          return;
        }

        default:
          emitError(`unknown identity action "${action}". Use "status", "join", "use", or "clear".`, asJson);
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
