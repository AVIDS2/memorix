import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ClaimStore } from '../../src/knowledge/claim-store.js';
import { writeClaim } from '../../src/knowledge/claims.js';
import { compileKnowledgeWorkspace } from '../../src/knowledge/wiki.js';
import { initializeKnowledgeWorkspace } from '../../src/knowledge/workspace.js';
import { collectLifecycleDiagnostics } from '../../src/runtime/lifecycle-status.js';
import { MaintenanceJobStore } from '../../src/runtime/maintenance-jobs.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let dataDir = '';

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-lifecycle-status-'));
});

afterEach(async () => {
  closeAllDatabases();
  await fs.rm(dataDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
});

describe('lifecycle diagnostics', () => {
  it('reports repairable queue failures, claim review state, and pending workspace proposals without leaking payloads', { timeout: 15_000 }, async () => {
    const claims = new ClaimStore();
    await claims.init(dataDir);
    writeClaim(claims, {
      projectId: 'project-a',
      subject: 'auth',
      predicate: 'decision',
      objectValue: 'use signed sessions',
      scope: 'project',
      evidence: [{
        evidenceKind: 'observation',
        evidenceId: 'observation:1',
        relation: 'supports',
      }],
    });
    const workspace = await initializeKnowledgeWorkspace({
      projectId: 'project-a',
      dataDir,
      mode: 'local',
    });
    await compileKnowledgeWorkspace({ workspace, claims });
    const queue = new MaintenanceJobStore(dataDir);
    const failed = queue.enqueue({
      projectId: 'project-a',
      kind: 'knowledge-lint',
      payload: { shouldNotAppear: 'api_key=sk-abcdefghijklmnopqrstuvwxyz123456' },
      maxAttempts: 1,
    });
    queue.claimNext({ workerId: 'status-test' });
    queue.fail(failed.id, 'status-test', new Error('lint provider api_key=sk-abcdefghijklmnopqrstuvwxyz123456'));

    const diagnostics = await collectLifecycleDiagnostics({ dataDir, projectId: 'project-a' });

    expect(diagnostics.maintenance.summary).toMatchObject({ total: 1, failed: 1 });
    expect(diagnostics.maintenance.failedJobs).toEqual([
      expect.objectContaining({ kind: 'knowledge-lint', lastError: expect.stringContaining('[REDACTED]') }),
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(diagnostics.claims).toMatchObject({ total: 1, active: 1, needsReview: 0, conflicts: 0 });
    expect(diagnostics.workspaces).toEqual([
      expect.objectContaining({ mode: 'local', pendingProposals: 1 }),
    ]);
    expect(diagnostics.workflows).toMatchObject({ total: 0, active: 0, failedRuns: 0 });
  });
});
