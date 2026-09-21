import { defineCommand } from 'citty';
import {
  TaskContinuityStore,
  type TaskContinuityEventKind,
  type TaskContinuityOutcomeStatus,
  type TaskContinuityVerificationStatus,
} from '../../knowledge/task-continuity.js';
import {
  emitError,
  emitResult,
  getCliProjectContext,
  parseCsvList,
} from './operator-shared.js';

const recordKinds: Array<Exclude<TaskContinuityEventKind, 'task' | 'outcome'>> = [
  'requirement',
  'decision',
  'verification',
  'risk',
];

export default defineCommand({
  meta: {
    name: 'continuity',
    description: 'Track task requirements, decisions, verification, risks, and outcomes',
  },
  args: {
    taskId: { type: 'string', description: 'Continuity task id' },
    task: { type: 'string', description: 'Task description for start' },
    requirements: { type: 'string', description: 'Comma-separated requirements for start' },
    kind: { type: 'string', description: 'requirement, decision, verification, or risk' },
    content: { type: 'string', description: 'Entry or outcome text' },
    verificationStatus: { type: 'string', description: 'pending, passed, failed, or skipped' },
    status: { type: 'string', description: 'completed, blocked, or abandoned for close' },
    source: { type: 'string', description: 'Source or evidence reference' },
    evidence: { type: 'string', description: 'Comma-separated evidence references' },
    actor: { type: 'string', description: 'Actor id or label' },
    limit: { type: 'string', description: 'Maximum ledgers for list' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const action = (args._ as string[])?.[0] || '';
    const asJson = !!args.json;
    try {
      const { project, dataDir, identity } = await getCliProjectContext({ searchIndex: false });
      const store = new TaskContinuityStore();
      await store.init(dataDir);
      const actor = String(args.actor || identity?.agentId || '').trim() || undefined;
      if (action === 'start') {
        if (!args.task) {
          emitError('task is required for "memorix continuity start"', asJson);
          return;
        }
        const result = store.start({
          projectId: project.id,
          task: String(args.task),
          ...(args.taskId ? { taskId: String(args.taskId) } : {}),
          requirements: parseCsvList(args.requirements as string | undefined),
          ...(actor ? { actor } : {}),
        });
        emitResult({ project, ...result }, 'Continuity started: ' + result.taskId, asJson);
        return;
      }
      if (action === 'list') {
        const ledgers = store.list(project.id, Number(args.limit || 20));
        emitResult(
          { project, ledgers },
          ledgers.length
            ? ledgers.map(item => item.status + ': ' + item.taskId + ' ' + item.task).join('\n')
            : 'No continuity ledgers found.',
          asJson,
        );
        return;
      }
      const taskId = String(args.taskId || '').trim();
      if (!taskId) {
        emitError('taskId is required for this continuity action.', asJson);
        return;
      }
      if (action === 'show') {
        const ledger = store.get(project.id, taskId);
        if (!ledger) {
          emitError('Task continuity ledger not found.', asJson);
          return;
        }
        emitResult({ project, ledger }, JSON.stringify(ledger, null, 2), asJson);
        return;
      }
      if (action === 'record') {
        const kind = String(args.kind || '').trim() as Exclude<TaskContinuityEventKind, 'task' | 'outcome'>;
        const content = String(args.content || '').trim();
        if (!recordKinds.includes(kind) || !content) {
          emitError('record requires --kind (requirement, decision, verification, risk) and --content.', asJson);
          return;
        }
        const verificationStatus = args.verificationStatus
          ? String(args.verificationStatus).trim() as TaskContinuityVerificationStatus
          : undefined;
        if (verificationStatus && !['pending', 'passed', 'failed', 'skipped'].includes(verificationStatus)) {
          emitError('verificationStatus must be pending, passed, failed, or skipped.', asJson);
          return;
        }
        const result = store.record({
          projectId: project.id,
          taskId,
          kind,
          content,
          ...(verificationStatus ? { verificationStatus } : {}),
          ...(args.source ? { sourceRef: String(args.source) } : {}),
          evidenceRefs: parseCsvList(args.evidence as string | undefined),
          ...(actor ? { actor } : {}),
        });
        emitResult({ project, ...result }, 'Continuity recorded: ' + kind, asJson);
        return;
      }
      if (action === 'close') {
        const status = String(args.status || '').trim() as TaskContinuityOutcomeStatus;
        const content = String(args.content || '').trim();
        if (!['completed', 'blocked', 'abandoned'].includes(status) || !content) {
          emitError('close requires --status (completed, blocked, abandoned) and --content.', asJson);
          return;
        }
        const result = store.close({
          projectId: project.id,
          taskId,
          status,
          content,
          ...(args.source ? { sourceRef: String(args.source) } : {}),
          evidenceRefs: parseCsvList(args.evidence as string | undefined),
          ...(actor ? { actor } : {}),
        });
        emitResult({ project, ...result }, 'Continuity closed: ' + status, asJson);
        return;
      }
      console.log('Memorix Task Continuity');
      console.log('');
      console.log('Usage:');
      console.log('  memorix continuity start --task "..." [--requirements "a,b"]');
      console.log('  memorix continuity record --taskId <id> --kind decision --content "..."');
      console.log('  memorix continuity record --taskId <id> --kind verification --verificationStatus passed --content "..."');
      console.log('  memorix continuity show|list --taskId <id>');
      console.log('  memorix continuity close --taskId <id> --status completed --content "..."');
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
