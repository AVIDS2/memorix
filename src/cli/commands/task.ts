import { defineCommand } from 'citty';
import { emitError, emitResult, getCliProjectContext, parseCsvList, parseOptionalJsonObject, shortId } from './operator-shared.js';

export default defineCommand({
  meta: {
    name: 'task',
    description: 'Create, claim, complete, and inspect team tasks',
  },
  args: {
    description: { type: 'string', description: 'Task description (for create)' },
    deps: { type: 'string', description: 'Comma-separated dependency task IDs' },
    taskId: { type: 'string', description: 'Task ID for claim, complete, fail, or release' },
    agentId: { type: 'string', description: 'Agent ID for claim, complete, fail, release, or agent-aware list' },
    result: { type: 'string', description: 'Completion or failure summary' },
    status: { type: 'string', description: 'Filter by status for list' },
    available: { type: 'boolean', description: 'Show only claimable tasks' },
    metadata: { type: 'string', description: 'JSON metadata object for create' },
    requiredRole: { type: 'string', description: 'Required role for this task' },
    preferredRole: { type: 'string', description: 'Preferred role for this task' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const action = (args._ as string[])?.[0] || '';
    const asJson = !!args.json;

    try {
      const { project, teamStore } = await getCliProjectContext();

      switch (action) {
        case 'create': {
          if (!args.description) {
            emitError('description is required for "memorix task create"', asJson);
            return;
          }

          const metadata = parseOptionalJsonObject(args.metadata as string | undefined, 'metadata');
          if (metadata) {
            const { checkPipelineGuards } = await import('../../orchestrate/planner.js');
            const guard = checkPipelineGuards({
              existingTasks: teamStore.listTasks(project.id),
              newTaskMeta: metadata,
            });
            if (!guard.allowed) {
              emitError(guard.reason, asJson);
              return;
            }
          }

          const task = teamStore.createTask({
            projectId: project.id,
            description: args.description as string,
            deps: parseCsvList(args.deps as string | undefined),
            metadata,
            createdBy: args.agentId as string | undefined,
            requiredRole: args.requiredRole as string | undefined,
            preferredRole: args.preferredRole as string | undefined,
          });
          const deps = teamStore.getTaskDeps(task.task_id);
          emitResult(
            { project, task, deps },
            `Task created: ${shortId(task.task_id)} "${task.description}"${deps.length > 0 ? ` (${deps.length} dep)` : ''}`,
            asJson,
          );
          return;
        }

        case 'claim': {
          if (!args.taskId || !args.agentId) {
            emitError('taskId and agentId are required for "memorix task claim"', asJson);
            return;
          }
          const result = teamStore.claimTask(args.taskId as string, args.agentId as string);
          if (!result.success) {
            emitError(result.reason ?? 'Unable to claim task', asJson);
            return;
          }
          emitResult(
            { project, result },
            `Task claimed: ${result.task?.description ?? args.taskId}${result.hint ? `\nHint: ${result.hint}` : ''}`,
            asJson,
          );
          return;
        }

        case 'complete': {
          if (!args.taskId || !args.agentId || !args.result) {
            emitError('taskId, agentId, and result are required for "memorix task complete"', asJson);
            return;
          }
          const result = teamStore.completeTask(args.taskId as string, args.agentId as string, args.result as string);
          if (!result.success) {
            emitError(result.reason ?? 'Unable to complete task', asJson);
            return;
          }
          emitResult(
            { project, task: teamStore.getTask(args.taskId as string), result: args.result },
            `Task completed: ${shortId(args.taskId as string)}`,
            asJson,
          );
          return;
        }

        case 'fail': {
          if (!args.taskId || !args.agentId || !args.result) {
            emitError('taskId, agentId, and result are required for "memorix task fail"', asJson);
            return;
          }
          const result = teamStore.failTask(args.taskId as string, args.agentId as string, args.result as string);
          if (!result.success) {
            emitError(result.reason ?? 'Unable to fail task', asJson);
            return;
          }
          emitResult(
            { project, task: teamStore.getTask(args.taskId as string), result: args.result },
            `Task failed: ${shortId(args.taskId as string)}`,
            asJson,
          );
          return;
        }

        case 'release': {
          if (!args.taskId || !args.agentId) {
            emitError('taskId and agentId are required for "memorix task release"', asJson);
            return;
          }
          const result = teamStore.releaseTask(args.taskId as string, args.agentId as string);
          if (!result.success) {
            emitError(result.reason ?? 'Unable to release task', asJson);
            return;
          }
          emitResult(
            { project, task: teamStore.getTask(args.taskId as string) },
            `Task released: ${shortId(args.taskId as string)}`,
            asJson,
          );
          return;
        }

        case 'list': {
          const tasks =
            args.available && args.agentId
              ? teamStore.listTasksForAgent(project.id, args.agentId as string)
              : teamStore.listTasks(
                  project.id,
                  args.available
                    ? { available: true }
                    : args.status
                      ? { status: args.status as string }
                      : undefined,
                );
          const payload = tasks.map((task) => ({
            ...task,
            deps: teamStore.getTaskDeps(task.task_id),
          }));
          emitResult(
            { project, tasks: payload },
            tasks.length === 0
              ? 'No tasks found.'
              : payload
                  .map((task) => {
                    const assignee = task.assignee_agent_id
                      ? teamStore.getAgent(task.assignee_agent_id)?.name ?? shortId(task.assignee_agent_id)
                      : 'unassigned';
                    const roleTag = task.required_role
                      ? `[${task.required_role}${task.preferred_role && task.preferred_role !== task.required_role ? ` -> ${task.preferred_role}` : ''}]`
                      : task.preferred_role
                        ? `[~${task.preferred_role}]`
                        : '';
                    return `- ${task.status}: ${shortId(task.task_id)} "${task.description}" - ${assignee} ${roleTag}`.trim();
                  })
                  .join('\n'),
            asJson,
          );
          return;
        }

        default:
          console.log('Memorix Task Commands');
          console.log('');
          console.log('Usage:');
          console.log('  memorix task create --description "..." [--agentId <id>] [--deps id1,id2]');
          console.log('  memorix task claim --taskId <id> --agentId <id>');
          console.log('  memorix task complete --taskId <id> --agentId <id> --result "..."');
          console.log('  memorix task fail --taskId <id> --agentId <id> --result "..."');
          console.log('  memorix task release --taskId <id> --agentId <id>');
          console.log('  memorix task list [--status pending|in_progress|completed|failed] [--available --agentId <id>]');
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
