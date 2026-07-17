import { defineCommand } from 'citty';
import { CodeGraphStore } from '../../codegraph/store.js';
import { ClaimStore } from '../../knowledge/claim-store.js';
import { applyKnowledgeProposal, compileKnowledgeWorkspace, lintKnowledgeWorkspace } from '../../knowledge/wiki.js';
import { initializeKnowledgeWorkspace, loadKnowledgeWorkspace } from '../../knowledge/workspace.js';
import { KnowledgeWorkspaceStore } from '../../knowledge/workspace-store.js';
import { WorkflowStore } from '../../knowledge/workflow-store.js';
import {
  applyWorkflowAdapter,
  importWindsurfWorkflows,
  previewWorkflowAdapter,
  recordWorkflowRun,
  selectWorkspaceWorkflows,
  syncCanonicalWorkflows,
} from '../../knowledge/workflows.js';
import { emitError, emitResult, getCliProjectContext } from './operator-shared.js';

function modeFrom(value: unknown): 'local' | 'versioned' {
  if (!value || value === 'local') return 'local';
  if (value === 'versioned') return 'versioned';
  throw new Error('knowledge mode must be local or versioned');
}

function usage(): string {
  return [
    'Memorix Knowledge Commands',
    '',
    '  memorix knowledge init [--mode local]',
    '  memorix knowledge init --mode versioned --path C:\\project\\docs\\knowledge',
    '  memorix knowledge status',
    '  memorix knowledge compile',
    '  memorix knowledge lint',
    '  memorix knowledge apply --proposal <id> [--force]',
    '  memorix knowledge workflow import',
    '  memorix knowledge workflow list',
    '  memorix knowledge workflow select --task "prepare a release"',
    '  memorix knowledge workflow preview --id <workflow-id> --agent codex',
    '  memorix knowledge workflow apply --id <workflow-id> --agent codex',
    '  memorix knowledge workflow run --id <workflow-id> --task "..." --outcome passed',
  ].join('\n');
}

function requiredText(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(field + ' is required');
  return text;
}

function workflowOutcome(value: unknown): 'passed' | 'failed' | 'cancelled' | 'in-progress' {
  if (value === 'passed' || value === 'failed' || value === 'cancelled' || value === 'in-progress') return value;
  throw new Error('workflow outcome must be passed, failed, cancelled, or in-progress');
}

function workflowVerdict(value: unknown): 'passed' | 'failed' | 'not-run' | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'passed' || value === 'failed' || value === 'not-run') return value;
  throw new Error('workflow verdict must be passed, failed, or not-run');
}

function evidenceList(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  return [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
}

export default defineCommand({
  meta: {
    name: 'knowledge',
    description: 'Initialize, review, and lint the Memorix Knowledge Workspace',
  },
  args: {
    action: { type: 'string', description: 'Action: init, status, compile, lint, or apply' },
    mode: { type: 'string', description: 'Workspace mode: local or versioned' },
    path: { type: 'string', description: 'Explicit versioned workspace path for init' },
    proposal: { type: 'string', description: 'Proposal id for apply' },
    force: { type: 'boolean', description: 'Explicitly allow an approved proposal to replace manual page edits' },
    id: { type: 'string', description: 'Canonical workflow id' },
    agent: { type: 'string', description: 'Target agent for a workflow adapter' },
    task: { type: 'string', description: 'Task wording for workflow selection or a workflow run' },
    outcome: { type: 'string', description: 'Workflow run outcome: passed, failed, cancelled, or in-progress' },
    verdict: { type: 'string', description: 'Workflow verification verdict: passed, failed, or not-run' },
    failure: { type: 'string', description: 'Sanitized failure reason for a workflow run' },
    snapshot: { type: 'string', description: 'Starting code snapshot id for a workflow run' },
    evidence: { type: 'string', description: 'Comma-separated evidence ids selected for a workflow run' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const positional = (args._ as string[]) ?? [];
    const action = (positional[0] || (args.action as string | undefined) || 'status').toLowerCase();
    const asJson = !!args.json;
    try {
      const { project, dataDir } = await getCliProjectContext();
      const mode = modeFrom(args.mode);
      if (action === 'init') {
        const workspace = await initializeKnowledgeWorkspace({
          projectId: project.id,
          dataDir,
          mode,
          ...(mode === 'versioned'
            ? {
              projectRoot: project.rootPath,
              rootPath: (args.path as string | undefined) ?? '',
            }
            : {}),
        });
        emitResult(
          { project, workspace },
          'Knowledge workspace initialized at ' + workspace.rootPath,
          asJson,
        );
        return;
      }

      const workspace = await loadKnowledgeWorkspace({ projectId: project.id, dataDir, mode });
      if (!workspace) {
        emitError('Knowledge workspace is not initialized. Run "memorix knowledge init" first.', asJson);
        return;
      }
      const claimStore = new ClaimStore();
      await claimStore.init(dataDir);
      const workspaceStore = new KnowledgeWorkspaceStore();
      await workspaceStore.init(dataDir);

      if (action === 'workflow') {
        const workflowAction = (positional[1] || 'list').toLowerCase();
        const workflowStore = new WorkflowStore();
        await workflowStore.init(dataDir);
        const projectRoot = workspace.projectRoot ?? project.rootPath;

        if (workflowAction === 'import') {
          const result = await importWindsurfWorkflows({ workspace, projectRoot });
          emitResult(
            { project, workspace, result },
            'Imported ' + result.imported.length + ' Windsurf workflow(s); preserved ' + result.skipped.length + ' existing source or canonical file(s).',
            asJson,
          );
          return;
        }

        const synced = await syncCanonicalWorkflows(workspace);
        if (workflowAction === 'list') {
          emitResult(
            {
              project,
              workspace,
              workflows: workflowStore.listWorkflows(workspace.id),
              parseErrors: synced.errors,
            },
            [
              'Canonical workflows: ' + workflowStore.listWorkflows(workspace.id).length,
              'Parse errors: ' + synced.errors.length,
            ].join('\n'),
            asJson,
          );
          return;
        }

        if (workflowAction === 'select') {
          const task = requiredText(args.task, 'task');
          const result = await selectWorkspaceWorkflows({ workspace, task });
          emitResult(
            { project, workspace, task, ...result },
            result.selections.length
              ? 'Selected ' + result.selections.length + ' workflow(s) for this task.'
              : 'No project workflow matches this task.',
            asJson,
          );
          return;
        }

        const workflowId = requiredText(args.id, 'workflow id');
        const workflow = workflowStore.getWorkflow(workflowId);
        if (!workflow || workflow.workspaceId !== workspace.id) {
          emitError('Workflow was not found for this knowledge workspace.', asJson);
          return;
        }

        if (workflowAction === 'preview' || workflowAction === 'apply') {
          const agent = requiredText(args.agent, 'agent');
          const result = workflowAction === 'preview'
            ? await previewWorkflowAdapter({ workflow, projectRoot, agent: agent as any })
            : await applyWorkflowAdapter({ workflow, projectRoot, agent: agent as any });
          emitResult(
            { project, workspace, result },
            'Workflow adapter ' + result.status + ': ' + result.reason,
            asJson,
          );
          return;
        }

        if (workflowAction === 'run') {
          const task = requiredText(args.task, 'task');
          const outcome = workflowOutcome(args.outcome);
          const result = await recordWorkflowRun({
            workspace,
            run: {
              workflowId,
              projectId: project.id,
              task,
              outcome,
              ...(workflowVerdict(args.verdict) ? { verificationVerdict: workflowVerdict(args.verdict) } : {}),
              ...(typeof args.failure === 'string' && args.failure.trim() ? { failureReason: args.failure.trim() } : {}),
              ...(typeof args.snapshot === 'string' && args.snapshot.trim() ? { startingSnapshotId: args.snapshot.trim() } : {}),
              selectedEvidence: evidenceList(args.evidence),
            },
          });
          emitResult(
            { project, workspace, result },
            'Recorded workflow run ' + result.id + ' (' + result.outcome + ').',
            asJson,
          );
          return;
        }

        emitResult({ usage: usage() }, usage(), asJson);
        return;
      }

      switch (action) {
        case 'status': {
          const pages = workspaceStore.listPages(workspace.id);
          const pending = workspaceStore.listProposals(workspace.id, 'pending');
          emitResult(
            { project, workspace, pages, pendingProposals: pending },
            [
              'Knowledge workspace: ' + workspace.rootPath,
              '- Mode: ' + workspace.mode,
              '- Published pages: ' + pages.filter(page => page.status === 'active').length,
              '- Pending proposals: ' + pending.length,
              '- Status: ' + workspace.status,
            ].join('\n'),
            asJson,
          );
          return;
        }
        case 'compile': {
          const result = await compileKnowledgeWorkspace({ workspace, claims: claimStore });
          emitResult(
            { project, workspace, result },
            'Knowledge compilation completed: ' + result.proposals.length + ' proposal(s), ' + result.published.length + ' unchanged published page(s).',
            asJson,
          );
          return;
        }
        case 'lint': {
          const codeStore = new CodeGraphStore();
          await codeStore.init(dataDir);
          const result = await lintKnowledgeWorkspace({ workspace, claims: claimStore, codeStore });
          emitResult(
            { project, workspace, result },
            result.valid
              ? 'Knowledge workspace lint passed.'
              : 'Knowledge workspace lint found ' + result.issues.length + ' issue(s).',
            asJson,
          );
          return;
        }
        case 'apply': {
          const proposalId = (args.proposal as string | undefined)?.trim();
          if (!proposalId) {
            emitError('proposal is required for "memorix knowledge apply"', asJson);
            return;
          }
          const result = await applyKnowledgeProposal({
            workspace,
            proposalId,
            allowManualOverwrite: !!args.force,
          });
          emitResult(
            { project, workspace, result },
            'Knowledge proposal applied to ' + result.targetPath,
            asJson,
          );
          return;
        }
        default:
          emitResult({ usage: usage() }, usage(), asJson);
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});
