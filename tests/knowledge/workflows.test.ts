import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeKnowledgeWorkspace } from '../../src/knowledge/workspace.js';
import {
  applyWorkflowAdapter,
  importWindsurfWorkflows,
  parseWorkflowMarkdown,
  previewWorkflowAdapter,
  recordWorkflowRun,
  selectWorkspaceWorkflows,
  syncCanonicalWorkflows,
  writeCanonicalWorkflow,
} from '../../src/knowledge/workflows.js';
import type { WorkflowSpec } from '../../src/knowledge/workflow-types.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let root: string | null = null;

function tempRoot(): string {
  root = mkdtempSync(path.join(tmpdir(), 'memorix-workflows-'));
  return root;
}

function initGitRepository(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'tests@memorix.local'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Memorix Tests'], { cwd: dir, stdio: 'ignore' });
  writeFileSync(path.join(dir, 'README.md'), '# fixture\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial fixture'], { cwd: dir, stdio: 'ignore' });
}

function workflow(workspaceId: string, id: string, title: string, taskLenses: string[], body: string): WorkflowSpec {
  return {
    id,
    workspaceId,
    title,
    description: title + ' workflow',
    status: 'active',
    version: 1,
    taskLenses,
    triggers: taskLenses,
    assumptions: [],
    requiredContext: [],
    guardrails: ['Do not overwrite user configuration.'],
    allowedTools: ['git', 'npm'],
    phases: [{
      id: 'prepare',
      title: 'Prepare',
      instructions: 'Read the relevant project state before changing files.',
      branches: [],
      expectedOutputs: [],
      verificationGates: ['Focused tests pass.'],
    }],
    verificationGates: ['Focused tests pass.'],
    claimIds: [],
    evidenceRefs: [],
    codeRefs: [],
    compatibleAgents: ['codex', 'claude-code', 'cursor', 'windsurf'],
    body,
    sourcePath: 'workflows/' + id.replace(/^workflow:/, '') + '.md',
    sourceHash: '',
    contentHash: '',
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
  };
}

afterEach(() => {
  closeAllDatabases();
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe('Workflow Inheritance', () => {
  it('keeps the repository release workflow parseable and explicit about approval', () => {
    const sourcePath = path.join(process.cwd(), 'docs', 'knowledge', 'workflows', 'memorix-release.md');
    const workflow = parseWorkflowMarkdown(readFileSync(sourcePath, 'utf8'), {
      workspaceId: 'workspace:memorix',
      sourcePath: 'workflows/memorix-release.md',
    });

    expect(workflow).toMatchObject({
      id: 'memorix-release',
      status: 'active',
      taskLenses: ['release'],
      verificationGates: expect.arrayContaining([
        'npm run lint passes',
        'npm run build passes',
        'npm test passes',
        'Package smoke passes',
        'Maintainer approval is explicit before publishing',
      ]),
    });
    expect(workflow.body).toMatch(/explicit maintainer approval/i);
  });

  it('imports a Windsurf workflow as canonical Markdown without changing its source', async () => {
    const sandbox = tempRoot();
    const projectRoot = path.join(sandbox, 'repo');
    const dataDir = path.join(sandbox, 'data');
    mkdirSync(path.join(projectRoot, '.windsurf', 'workflows'), { recursive: true });
    initGitRepository(projectRoot);
    const sourcePath = path.join(projectRoot, '.windsurf', 'workflows', 'release.md');
    const source = [
      '---',
      'description: Publish a verified release',
      '---',
      '',
      '## Prepare',
      '',
      'Check the changelog and tests.',
      '',
      '## Publish',
      '',
      'Publish only after package smoke passes.',
      '',
    ].join('\n');
    writeFileSync(sourcePath, source, 'utf8');
    const workspace = await initializeKnowledgeWorkspace({
      projectId: 'org/repo',
      dataDir,
      mode: 'local',
    });

    const result = await importWindsurfWorkflows({ workspace, projectRoot });

    expect(result.imported).toHaveLength(1);
    expect(readFileSync(sourcePath, 'utf8')).toBe(source);
    expect(result.imported[0]).toMatchObject({
      status: 'active',
      taskLenses: ['release'],
      importedFrom: '.windsurf/workflows/release.md',
    });
    expect(existsSync(path.join(workspace.rootPath, result.imported[0].sourcePath))).toBe(true);

    const second = await importWindsurfWorkflows({ workspace, projectRoot });
    expect(second.imported).toHaveLength(0);
    expect(second.skipped[0].reason).toMatch(/preserved/i);
  });

  it('preserves a canonical Windsurf workflow contract and ignores generic verification words for release selection', async () => {
    const sandbox = tempRoot();
    const projectRoot = path.join(sandbox, 'repo');
    const dataDir = path.join(sandbox, 'data');
    mkdirSync(path.join(projectRoot, '.windsurf', 'workflows'), { recursive: true });
    initGitRepository(projectRoot);
    writeFileSync(path.join(projectRoot, '.windsurf', 'workflows', 'release.md'), [
      '---',
      'id: patch-release',
      'title: Patch release',
      'description: Prepare a patch release with explicit verification evidence.',
      'status: active',
      'version: 1',
      'taskLenses: [release, test]',
      'triggers: [release, publish, npm]',
      'allowedAgents: [codex, claude-code, windsurf]',
      'verificationGates: [focused tests pass, changelog reviewed, package smoke passes]',
      '---',
      '',
      '## Inspect',
      '',
      'Read the current version and unresolved release risks.',
      '',
      '## Verify',
      '',
      'Run focused verification before publishing.',
      '',
    ].join('\n'), 'utf8');
    const workspace = await initializeKnowledgeWorkspace({
      projectId: 'org/repo',
      dataDir,
      mode: 'local',
    });

    const imported = await importWindsurfWorkflows({ workspace, projectRoot });
    expect(imported.imported).toHaveLength(1);
    expect(imported.imported[0]).toMatchObject({
      id: 'patch-release',
      title: 'Patch release',
      sourcePath: 'workflows/patch-release.md',
      importedFrom: '.windsurf/workflows/release.md',
      verificationGates: ['focused tests pass', 'changelog reviewed', 'package smoke passes'],
      compatibleAgents: ['codex', 'claude-code', 'windsurf'],
    });

    const unrelated = await selectWorkspaceWorkflows({
      workspace,
      task: 'Investigate token 401 and run focused verification.',
    });
    expect(unrelated.selections).toHaveLength(0);

    const release = await selectWorkspaceWorkflows({
      workspace,
      task: 'Prepare and publish the npm patch release.',
    });
    expect(release.selections.map(selection => selection.workflow.id)).toEqual(['patch-release']);
  });

  it('selects only matching active workflows and exposes prior failed verification as a caution', async () => {
    const sandbox = tempRoot();
    const dataDir = path.join(sandbox, 'data');
    const workspace = await initializeKnowledgeWorkspace({
      projectId: 'org/repo',
      dataDir,
      mode: 'local',
    });
    const release = await writeCanonicalWorkflow({
      workspace,
      workflow: workflow(workspace.id, 'workflow:release', 'Release', ['release'], '## Prepare\n\nReview release state.'),
    });
    await writeCanonicalWorkflow({
      workspace,
      workflow: workflow(workspace.id, 'workflow:bugfix', 'Bugfix', ['bugfix'], '## Diagnose\n\nReproduce the failure.'),
    });
    await recordWorkflowRun({
      workspace,
      run: {
        workflowId: release.id,
        projectId: 'org/repo',
        task: 'publish an earlier release',
        outcome: 'failed',
        verificationVerdict: 'failed',
        failureReason: 'Package smoke did not pass.',
      },
    });

    const releaseSelection = await selectWorkspaceWorkflows({
      workspace,
      task: 'Prepare and publish the npm release.',
    });
    expect(releaseSelection.selections).toHaveLength(1);
    expect(releaseSelection.selections[0].workflow.id).toBe(release.id);
    expect(releaseSelection.selections[0].firstPhase.title).toBe('Prepare');
    expect(releaseSelection.selections[0].cautions.join(' ')).toMatch(/Package smoke/i);

    const unrelated = await selectWorkspaceWorkflows({
      workspace,
      task: 'What is the capital of France?',
    });
    expect(unrelated.selections).toHaveLength(0);
  });

  it('previews and applies only Memorix-owned adapters, preserving user project files', async () => {
    const sandbox = tempRoot();
    const projectRoot = path.join(sandbox, 'repo');
    const dataDir = path.join(sandbox, 'data');
    mkdirSync(projectRoot, { recursive: true });
    initGitRepository(projectRoot);
    const workspace = await initializeKnowledgeWorkspace({
      projectId: 'org/repo',
      dataDir,
      mode: 'local',
    });
    const release = await writeCanonicalWorkflow({
      workspace,
      workflow: workflow(workspace.id, 'workflow:release', 'Release', ['release'], '## Prepare\n\nReview release state.'),
    });

    const firstPreview = await previewWorkflowAdapter({
      workflow: release,
      projectRoot,
      agent: 'codex',
    });
    expect(firstPreview.status).toBe('create');
    expect(firstPreview.targetPath).toContain(path.join('.agents', 'skills'));
    const applied = await applyWorkflowAdapter({ workflow: release, projectRoot, agent: 'codex' });
    expect(applied.status).toBe('create');
    expect(readFileSync(applied.targetPath!, 'utf8')).toContain('memorix:workflow-adapter');

    const ownedPreview = await previewWorkflowAdapter({ workflow: release, projectRoot, agent: 'codex' });
    expect(ownedPreview.status).toBe('unchanged');

    const userPath = path.join(projectRoot, '.cursor', 'rules', 'memorix-workflow-release.mdc');
    mkdirSync(path.dirname(userPath), { recursive: true });
    writeFileSync(userPath, '# user owned rule\n', 'utf8');
    const conflict = await applyWorkflowAdapter({ workflow: release, projectRoot, agent: 'cursor' });
    expect(conflict.status).toBe('conflict');
    expect(readFileSync(userPath, 'utf8')).toBe('# user owned rule\n');

    const unsupported = await previewWorkflowAdapter({ workflow: release, projectRoot, agent: 'openclaw' });
    expect(unsupported.status).toBe('unsupported');
  });

  it('reports malformed canonical workflows instead of treating them as active', async () => {
    const sandbox = tempRoot();
    const dataDir = path.join(sandbox, 'data');
    const workspace = await initializeKnowledgeWorkspace({
      projectId: 'org/repo',
      dataDir,
      mode: 'local',
    });
    writeFileSync(path.join(workspace.rootPath, 'workflows', 'bad.md'), '---\nid: bad\n---\n', 'utf8');

    const synced = await syncCanonicalWorkflows(workspace);

    expect(synced.workflows).toHaveLength(0);
    expect(synced.errors).toEqual([
      expect.objectContaining({ sourcePath: 'workflows/bad.md' }),
    ]);
  });
});
