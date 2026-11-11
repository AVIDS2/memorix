import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ClaimStore } from '../../src/knowledge/claim-store.js';
import { writeClaim } from '../../src/knowledge/claims.js';
import { KnowledgeWorkspaceStore } from '../../src/knowledge/workspace-store.js';
import { initializeKnowledgeWorkspace } from '../../src/knowledge/workspace.js';
import type { MaintenanceJob } from '../../src/runtime/maintenance-jobs.js';
import { createProjectMaintenanceHandler } from '../../src/runtime/project-maintenance.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let sandbox = '';
let projectRoot = '';
let dataDir = '';

function job(kind: MaintenanceJob['kind'], payload: Record<string, unknown> = {}): MaintenanceJob {
  return {
    id: 'job-' + kind,
    projectId: 'org/repo',
    kind,
    dedupeKey: kind,
    payload,
    status: 'running',
    attempts: 1,
    maxAttempts: 8,
    runAfter: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

beforeEach(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-maintenance-workspace-'));
  projectRoot = path.join(sandbox, 'repo');
  dataDir = path.join(sandbox, 'data');
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'README.md'), '# fixture\n', 'utf8');
  execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'tests@memorix.local'], { cwd: projectRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Memorix Tests'], { cwd: projectRoot, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: projectRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: projectRoot, stdio: 'ignore' });
});

afterEach(async () => {
  closeAllDatabases();
  await fs.rm(sandbox, { recursive: true, force: true });
});

describe('project maintenance workspace selection', () => {
  it('prefers the Workset-visible versioned workspace while protecting it from implicit compile writes', async () => {
    const claims = new ClaimStore();
    await claims.init(dataDir);
    writeClaim(claims, {
      projectId: 'org/repo',
      subject: 'authentication',
      predicate: 'decision',
      objectValue: 'use signed cookies',
      scope: 'project',
      evidence: [{
        evidenceKind: 'observation',
        evidenceId: 'observation:1',
        relation: 'supports',
        locator: 'observation/1',
      }],
    });
    const local = await initializeKnowledgeWorkspace({
      projectId: 'org/repo',
      dataDir,
      mode: 'local',
    });
    const versioned = await initializeKnowledgeWorkspace({
      projectId: 'org/repo',
      dataDir,
      mode: 'versioned',
      projectRoot,
      rootPath: path.join(projectRoot, 'docs', 'knowledge'),
    });
    const handler = createProjectMaintenanceHandler('org/repo', dataDir, projectRoot);

    await expect(handler(job('knowledge-compile'))).resolves.toEqual({ action: 'complete' });

    let workspaceStore = new KnowledgeWorkspaceStore();
    await workspaceStore.init(dataDir);
    expect(workspaceStore.listProposals(local.id)).toEqual([]);
    expect(workspaceStore.listProposals(versioned.id)).toEqual([]);

    await expect(handler(job('knowledge-lint'))).resolves.toEqual({ action: 'complete' });

    workspaceStore = new KnowledgeWorkspaceStore();
    await workspaceStore.init(dataDir);
    expect(workspaceStore.getWorkspace(versioned.id)?.lastLintedAt).toBeTruthy();
    expect(workspaceStore.getWorkspace(local.id)?.lastLintedAt).toBeUndefined();

    await expect(handler(job('knowledge-compile', { allowVersionedWrite: true }))).resolves.toEqual({ action: 'complete' });

    workspaceStore = new KnowledgeWorkspaceStore();
    await workspaceStore.init(dataDir);
    expect(workspaceStore.listProposals(versioned.id)).toHaveLength(1);
    expect(workspaceStore.listProposals(local.id)).toEqual([]);
  });
});
