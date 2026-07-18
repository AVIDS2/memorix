import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaimStore } from '../../src/knowledge/claim-store.js';
import { writeClaim } from '../../src/knowledge/claims.js';
import { applyKnowledgeProposal, compileKnowledgeWorkspace } from '../../src/knowledge/wiki.js';
import { initializeKnowledgeWorkspace } from '../../src/knowledge/workspace.js';
import { buildTaskWorkset } from '../../src/knowledge/workset.js';
import { recordWorkflowRun, writeCanonicalWorkflow } from '../../src/knowledge/workflows.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let dataDir: string | null = null;

function tempDir(): string {
  dataDir = mkdtempSync(path.join(tmpdir(), 'memorix-workset-'));
  return dataDir;
}

afterEach(() => {
  closeAllDatabases();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = null;
});

describe('Task Workset', () => {
  it('combines source-backed claims, reviewed pages, workflows, state cautions, and verification within budget', async () => {
    const root = tempDir();
    const store = new ClaimStore();
    await store.init(root);
    const written = writeClaim(store, {
      projectId: 'org/repo',
      subject: 'release',
      predicate: 'requires',
      objectValue: 'package smoke test before publishing',
      scope: 'workflow',
      evidence: [{
        evidenceKind: 'test',
        evidenceId: 'test:package-smoke',
        relation: 'verifies',
        locator: 'tests/package-smoke.test.ts',
        capturedHash: 'package-smoke-v1',
      }],
    });
    const workspace = await initializeKnowledgeWorkspace({
      projectId: 'org/repo',
      dataDir: root,
      mode: 'local',
    });
    const compiled = await compileKnowledgeWorkspace({ workspace, claims: store });
    await applyKnowledgeProposal({ workspace, proposalId: compiled.proposals[0].id });
    const workflow = await writeCanonicalWorkflow({
      workspace,
      workflow: {
        id: 'workflow:release',
        workspaceId: workspace.id,
        title: 'Release',
        description: 'Prepare a verified release.',
        status: 'active',
        version: 1,
        taskLenses: ['release'],
        triggers: ['publish', 'npm'],
        assumptions: [],
        requiredContext: [],
        guardrails: [],
        allowedTools: ['git', 'npm'],
        phases: [{
          id: 'prepare',
          title: 'Prepare',
          instructions: 'Check metadata and the focused tests before publishing.',
          branches: [],
          expectedOutputs: [],
          verificationGates: ['Package smoke passes.'],
        }],
        verificationGates: ['Package smoke passes.'],
        claimIds: [written.claim.id],
        evidenceRefs: ['test:test:package-smoke'],
        codeRefs: [],
        compatibleAgents: ['codex'],
        body: '## Prepare\n\nCheck metadata and focused tests before publishing.',
        sourcePath: 'workflows/release.md',
        sourceHash: '',
        contentHash: '',
        createdAt: '2026-07-17T00:00:00.000Z',
        updatedAt: '2026-07-17T00:00:00.000Z',
      },
    });
    await recordWorkflowRun({
      workspace,
      run: {
        workflowId: workflow.id,
        projectId: 'org/repo',
        task: 'previous release',
        outcome: 'failed',
        verificationVerdict: 'failed',
        failureReason: 'Package smoke did not pass.',
      },
    });

    const workset = await buildTaskWorkset({
      projectId: 'org/repo',
      dataDir: root,
      task: 'Prepare and publish the npm release.',
      lens: 'release',
      currentFacts: ['Package version: 1.2.0', 'Git: dirty worktree'],
      codeState: 'Code state: dirty worktree, incomplete scan.',
      startHere: ['package.json', 'CHANGELOG.md'],
      reliableMemory: [{
        id: 9,
        title: 'The release path validates package output.',
        type: 'decision',
        status: 'current',
        path: 'package.json',
      }],
      cautionMemory: [],
      verificationHints: ['Verify package metadata and Git state before publishing.'],
      worktreeDirty: true,
      snapshot: {
        id: 'snapshot:release',
        sourceEpoch: 3,
        worktreeState: 'dirty',
        incomplete: true,
      },
      freshness: { suspect: 1, stale: 0 },
    });

    expect(workset.claims).toEqual([
      expect.objectContaining({ id: written.claim.id }),
    ]);
    expect(workset.pages).toEqual([
      expect.objectContaining({ claimIds: [written.claim.id] }),
    ]);
    expect(workset.workflows).toEqual([
      expect.objectContaining({ id: workflow.id, firstPhase: expect.objectContaining({ title: 'Prepare' }) }),
    ]);
    expect(workset.cautions.map(caution => caution.kind)).toEqual(expect.arrayContaining([
      'dirty-worktree',
      'incomplete-scan',
      'suspect-code-memory',
      'workflow-failed-verification',
    ]));
    expect(workset.evidenceIds).toEqual(expect.arrayContaining([
      'claim:' + written.claim.id,
      'test:test:package-smoke',
    ]));
    expect(workset.prompt).toContain('Project knowledge');
    expect(workset.prompt).toContain('Project workflow');
    expect(workset.budget.tokenCount).toBeLessThanOrEqual(workset.budget.maxTokens);
  });

  it('returns no generic knowledge dump when task terms do not match durable artifacts', async () => {
    const root = tempDir();
    const workset = await buildTaskWorkset({
      projectId: 'org/repo',
      dataDir: root,
      task: 'What is the capital of France?',
      lens: 'general',
      currentFacts: [],
      startHere: [],
      reliableMemory: [],
      cautionMemory: [],
      verificationHints: ['Inspect the task-relevant code before editing.'],
      worktreeDirty: false,
      freshness: { suspect: 0, stale: 0 },
    });

    expect(workset.claims).toHaveLength(0);
    expect(workset.pages).toHaveLength(0);
    expect(workset.workflows).toHaveLength(0);
    expect(workset.prompt).not.toContain('Project knowledge');
    expect(workset.prompt).not.toContain('Project workflow');
  });

  it('puts state cautions ahead of optional detail when the token budget is tight', async () => {
    const root = tempDir();
    const workset = await buildTaskWorkset({
      projectId: 'org/repo',
      dataDir: root,
      task: 'Fix a failing startup regression with a very detailed issue description.',
      lens: 'bugfix',
      currentFacts: [
        'Package version: 1.2.0',
        'Latest changelog: 1.2.0 (2026-07-17)',
        'Git: dirty worktree',
        'Historical note: docs/old-progress.md (older than latest changelog)',
      ],
      codeState: 'Code state: dirty worktree, incomplete scan, current data may be missing.',
      startHere: ['src/startup.ts', 'tests/startup.test.ts', 'package.json', 'CHANGELOG.md', 'docs/old-progress.md'],
      reliableMemory: [{
        id: 1,
        title: 'A long current memory about startup behavior that is optional under pressure.',
        type: 'decision',
        status: 'current',
        path: 'src/startup.ts',
      }],
      cautionMemory: [],
      verificationHints: ['Run the smallest failing startup regression test first.'],
      worktreeDirty: true,
      snapshot: { worktreeState: 'dirty', incomplete: true },
      freshness: { suspect: 3, stale: 2 },
      maxTokens: 96,
    });

    expect(workset.prompt).toContain('Cautions');
    expect(workset.prompt).toContain('uncommitted changes');
    expect(workset.prompt).toContain('incomplete');
    expect(workset.budget.tokenCount).toBeLessThanOrEqual(96);
  });
});
