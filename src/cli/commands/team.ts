import { defineCommand } from 'citty';
import { AGENT_TYPE_ROLE_MAP } from '../../team/team-store.js';
import { emitError, emitResult, getCliProjectContext, parseCsvList, parsePositiveInt, shortId } from './operator-shared.js';

export default defineCommand({
  meta: {
    name: 'team',
    description: 'Manage project-scoped team collaboration state',
  },
  args: {
    name: { type: 'string', description: 'Agent display name' },
    agentType: { type: 'string', description: 'Agent type (codex, windsurf, gemini-cli, etc.)' },
    instanceId: { type: 'string', description: 'Stable instance identity' },
    role: { type: 'string', description: 'Explicit role override' },
    capabilities: { type: 'string', description: 'Comma-separated capability list' },
    agentId: { type: 'string', description: 'Agent ID for leave or targeted operations' },
    roleId: { type: 'string', description: 'Role identifier' },
    label: { type: 'string', description: 'Human-readable role label' },
    description: { type: 'string', description: 'Description text' },
    preferredAgentTypes: { type: 'string', description: 'Comma-separated preferred agent types' },
    maxConcurrent: { type: 'string', description: 'Maximum concurrent agents for a role' },
    all: { type: 'boolean', description: 'Show inactive/historical collaborators in status output' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const action = (args._ as string[])?.[0] || '';
    const asJson = !!args.json;

    try {
      const { project, teamStore } = await getCliProjectContext();

      switch (action) {
        case 'join': {
          const agentType = (args.agentType as string | undefined) || 'unknown';
          const resolvedRole =
            (args.role as string | undefined) ||
            AGENT_TYPE_ROLE_MAP[agentType] ||
            'engineer';
          const agent = teamStore.registerAgent({
            projectId: project.id,
            agentType,
            instanceId: args.instanceId as string | undefined,
            name: (args.name as string | undefined)?.trim() || undefined,
            role: resolvedRole,
            capabilities: parseCsvList(args.capabilities as string | undefined),
          });
          emitResult(
            { project, agent },
            `Joined project collaboration space as ${agent.name} (${agent.role})`,
            asJson,
          );
          return;
        }

        case 'leave': {
          const agentId = args.agentId as string | undefined;
          if (!agentId) {
            emitError('agentId is required for "memorix team leave"', asJson);
            return;
          }
          const left = teamStore.leaveAgent(agentId);
          const releasedLocks = teamStore.releaseAllLocks(agentId);
          const releasedTasks = teamStore.releaseTasksByAgent(agentId);
          if (!left) {
            emitError(`Agent "${agentId}" not found`, asJson);
            return;
          }
          emitResult(
            { project, agentId, releasedLocks, releasedTasks },
            `Left team: released ${releasedLocks} lock(s), ${releasedTasks} task(s)`,
            asJson,
          );
          return;
        }

        case 'roles': {
          const roles = teamStore.listRoles(project.id);
          const occupancy = teamStore.getRoleOccupancy(project.id);
          emitResult(
            { project, roles, occupancy },
            roles.length === 0
              ? 'No roles defined for this project.'
              : occupancy
                  .map(({ role, activeAgents, vacant }) => {
                    const shortRole = role.role_id.split(':').pop();
                    const names = activeAgents.map((agent) => agent.name).join(', ') || 'vacant';
                    return `${role.label} (${shortRole}): ${activeAgents.length}/${role.max_concurrent} filled, ${vacant} open\n  Agents: ${names}`;
                  })
                  .join('\n\n'),
            asJson,
          );
          return;
        }

        case 'add-role': {
          if (!args.roleId || !args.label) {
            emitError('roleId and label are required for "memorix team add-role"', asJson);
            return;
          }
          const role = teamStore.addRole(project.id, {
            roleId: args.roleId as string,
            label: args.label as string,
            description: args.description as string | undefined,
            preferredAgentTypes: parseCsvList(args.preferredAgentTypes as string | undefined),
            maxConcurrent: parsePositiveInt(args.maxConcurrent as string | undefined, 1),
          });
          emitResult(
            { project, role },
            `Role added: ${role.label} (${role.role_id})`,
            asJson,
          );
          return;
        }

        case 'remove-role': {
          const roleId = args.roleId as string | undefined;
          if (!roleId) {
            emitError('roleId is required for "memorix team remove-role"', asJson);
            return;
          }
          const removed = teamStore.removeRole(project.id, roleId);
          if (!removed) {
            emitError(`Role "${roleId}" not found`, asJson);
            return;
          }
          emitResult({ project, roleId }, `Role removed: ${roleId}`, asJson);
          return;
        }

        case 'status': {
          const agents = teamStore.listAgents(project.id);
          const occupancy = teamStore.getRoleOccupancy(project.id);
          const activeAgents = agents.filter((agent) => agent.status === 'active');
          const historicalAgents = agents.filter((agent) => agent.status !== 'active');
          const showAll = !!args.all;
          const visibleAgents = showAll ? agents : activeAgents;
          const formatAgent = (agent: typeof agents[number]) =>
            `- ${agent.name} [${agent.agent_type}] ${agent.role ?? 'no role'} (${shortId(agent.agent_id)})${agent.status === 'active' ? '' : ' (inactive)'}`;
          emitResult(
            {
              project,
              agents,
              visibleAgents,
              occupancy,
              activeCount: activeAgents.length,
              historicalCount: historicalAgents.length,
            },
            [
              `Project collaboration: ${activeAgents.length} active collaborator(s) / ${historicalAgents.length} historical or inactive`,
              '',
              occupancy.length > 0
                ? `Role occupancy:\n${occupancy
                    .map(({ role, activeAgents, vacant }) => {
                      const names = activeAgents.map((agent) => agent.name).join(', ') || 'vacant';
                      return `- ${role.label}: ${activeAgents.length}/${role.max_concurrent} (${names})${vacant > 0 ? `, ${vacant} open` : ''}`;
                    })
                    .join('\n')}`
                : 'Role occupancy: none',
              '',
              visibleAgents.length > 0
                ? `${showAll ? 'All collaborators' : 'Active collaborators'}:\n${visibleAgents.map(formatAgent).join('\n')}`
                : `${showAll ? 'All collaborators' : 'Active collaborators'}: none`,
              !showAll && historicalAgents.length > 0
                ? `\nHistorical/inactive collaborators: ${historicalAgents.length} (use --all to list).`
                : '',
            ].join('\n'),
            asJson,
          );
          return;
        }

        default:
          console.log('Memorix Team Commands');
          console.log('');
          console.log('Usage:');
          console.log('  memorix team status [--all]');
          console.log('  memorix team join --agentType codex [--name codex-main --instanceId abc]');
          console.log('  memorix team leave --agentId <id>');
          console.log('  memorix team roles');
          console.log('  memorix team add-role --roleId reviewer --label Reviewer [--description "..."]');
          console.log('  memorix team remove-role --roleId reviewer');
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
