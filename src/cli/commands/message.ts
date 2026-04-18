import { defineCommand } from 'citty';
import { emitError, emitResult, getCliProjectContext, shortId } from './operator-shared.js';

export default defineCommand({
  meta: {
    name: 'message',
    description: 'Send, broadcast, and read team messages from the CLI',
  },
  args: {
    from: { type: 'string', description: 'Sender agent ID' },
    to: { type: 'string', description: 'Recipient agent ID' },
    type: { type: 'string', description: 'Message type (request, response, info, handoff, etc.)' },
    content: { type: 'string', description: 'Message content' },
    agentId: { type: 'string', description: 'Agent ID for inbox reads' },
    markRead: { type: 'boolean', description: 'Mark inbox messages as read after listing them' },
    toRole: { type: 'string', description: 'Optional role target for the message' },
    handoffStatus: { type: 'string', description: 'Optional handoff status when type=handoff' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const action = (args._ as string[])?.[0] || '';
    const asJson = !!args.json;

    try {
      const { project, teamStore } = await getCliProjectContext();

      switch (action) {
        case 'send': {
          if (!args.from || !args.type || !args.content) {
            emitError('from, type, and content are required for "memorix message send"', asJson);
            return;
          }
          if (!args.to && !args.toRole) {
            emitError('Either --to or --toRole is required for "memorix message send"', asJson);
            return;
          }
          const message = teamStore.sendMessage({
            projectId: project.id,
            senderAgentId: args.from as string,
            recipientAgentId: (args.to as string | undefined) ?? null,
            type: args.type as string,
            content: args.content as string,
            toRole: (args.toRole as string | undefined) ?? null,
            handoffStatus:
              (args.handoffStatus as string | undefined) ??
              ((args.type as string) === 'handoff' ? 'open' : null),
          });
          if ('error' in message) {
            emitError(message.error, asJson);
            return;
          }
          emitResult(
            { project, message },
            `Message sent: ${shortId(message.id)} to ${args.to ? shortId(args.to as string) : `role ${args.toRole}`}`,
            asJson,
          );
          return;
        }

        case 'broadcast': {
          if (!args.from || !args.type || !args.content) {
            emitError('from, type, and content are required for "memorix message broadcast"', asJson);
            return;
          }
          const message = teamStore.sendMessage({
            projectId: project.id,
            senderAgentId: args.from as string,
            recipientAgentId: null,
            type: args.type as string,
            content: args.content as string,
          });
          if ('error' in message) {
            emitError(message.error, asJson);
            return;
          }
          emitResult(
            { project, message },
            `Broadcast sent: ${shortId(message.id)}`,
            asJson,
          );
          return;
        }

        case 'inbox': {
          const agentId = (args.agentId as string | undefined) || (args.from as string | undefined);
          if (!agentId) {
            emitError('agentId is required for "memorix message inbox"', asJson);
            return;
          }
          const messages = teamStore.getInbox(project.id, agentId);
          const unreadCount = teamStore.getUnreadCount(project.id, agentId);
          if (args.markRead) {
            teamStore.markAllRead(project.id, agentId);
          }
          emitResult(
            { project, unreadCount, messages },
            messages.length === 0
              ? 'Inbox empty.'
              : [`Inbox: ${unreadCount} unread / ${messages.length} total`, '', ...messages.map((message) => {
                  const sender = teamStore.getAgent(message.sender_agent_id);
                  return `- ${message.read_at ? ' ' : '*'} [${message.type}] from ${sender?.name ?? shortId(message.sender_agent_id)}: ${message.content}`;
                })].join('\n'),
            asJson,
          );
          return;
        }

        default:
          console.log('Memorix Message Commands');
          console.log('');
          console.log('Usage:');
          console.log('  memorix message send --from <agentId> --to <agentId> --type info --content "..."');
          console.log('  memorix message send --from <agentId> --toRole reviewer --type handoff --content "..."');
          console.log('  memorix message broadcast --from <agentId> --type announcement --content "..."');
          console.log('  memorix message inbox --agentId <id> [--markRead]');
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
