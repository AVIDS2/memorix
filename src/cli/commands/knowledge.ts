import { defineCommand } from 'citty';
import { CodeGraphStore } from '../../codegraph/store.js';
import { ClaimStore } from '../../knowledge/claim-store.js';
import { applyKnowledgeProposal, compileKnowledgeWorkspace, lintKnowledgeWorkspace } from '../../knowledge/wiki.js';
import { initializeKnowledgeWorkspace, loadKnowledgeWorkspace } from '../../knowledge/workspace.js';
import { KnowledgeWorkspaceStore } from '../../knowledge/workspace-store.js';
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
  ].join('\n');
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
