import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase } from '../../src/store/sqlite-db.js';
import { TaskContinuityStore } from '../../src/knowledge/task-continuity.js';
import { buildTaskWorkset } from '../../src/knowledge/workset.js';

const roots: string[] = [];

function tempDir(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'memorix-continuity-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    closeDatabase(root);
    rmSync(root, { recursive: true, force: true });
  }
});

describe('task continuity', () => {
  it('keeps requirements, decisions, verification, and outcomes append-only', async () => {
    const dataDir = tempDir();
    const store = new TaskContinuityStore();
    await store.init(dataDir);

    const started = store.start({
      projectId: 'org/repo',
      task: 'Harden the release path',
      requirements: ['Keep the package version on the 1.9.x line.'],
      actor: 'codex',
    });
    store.record({
      projectId: 'org/repo',
      taskId: started.taskId,
      kind: 'decision',
      content: 'Use the existing release gate instead of adding a second publisher.',
      sourceRef: 'reasoning:release-gate',
      evidenceRefs: ['file:package.json'],
    });
    store.record({
      projectId: 'org/repo',
      taskId: started.taskId,
      kind: 'verification',
      content: 'Run the full cross-platform CI matrix.',
      verificationStatus: 'pending',
      sourceRef: 'plan:ci',
    });
    store.record({
      projectId: 'org/repo',
      taskId: started.taskId,
      kind: 'verification',
      content: 'Full cross-platform CI matrix passed.',
      verificationStatus: 'passed',
      sourceRef: 'ci:run-42',
    });
    store.close({
      projectId: 'org/repo',
      taskId: started.taskId,
      status: 'completed',
      content: 'Release path is ready.',
      sourceRef: 'release:1.9.x',
    });

    const ledger = store.get('org/repo', started.taskId);
    expect(ledger).toMatchObject({
      taskId: started.taskId,
      task: 'Harden the release path',
      status: 'completed',
      requirements: ['Keep the package version on the 1.9.x line.'],
      decisions: ['Use the existing release gate instead of adding a second publisher.'],
      outcomes: ['Release path is ready.'],
    });
    expect(ledger?.verification).toEqual([
      expect.objectContaining({ content: 'Run the full cross-platform CI matrix.', status: 'pending' }),
      expect.objectContaining({ content: 'Full cross-platform CI matrix passed.', status: 'passed' }),
    ]);
    expect(ledger?.events).toHaveLength(6);
    expect(ledger?.events[2]).toMatchObject({
      sourceRef: 'reasoning:release-gate',
      evidenceRefs: ['file:package.json'],
    });
  });

  it('redacts credentials and isolates ledgers by project', async () => {
    const dataDir = tempDir();
    const store = new TaskContinuityStore();
    await store.init(dataDir);
    const started = store.start({
      projectId: 'org/repo-a',
      task: 'Investigate api_key=super-secret-value',
      requirements: ['Do not expose token=another-secret.'],
    });

    expect(store.get('org/repo-a', started.taskId)?.task).toContain('api_key=[REDACTED]');
    expect(store.get('org/repo-a', started.taskId)?.requirements[0]).toContain('token=[REDACTED]');
    expect(store.get('org/repo-b', started.taskId)).toBeUndefined();
  });

  it('delivers a bounded continuity section in the task workset', async () => {
    const root = tempDir();
    const workset = await buildTaskWorkset({
      projectId: 'org/repo',
      dataDir: root,
      task: 'Continue the release hardening task.',
      lens: 'release',
      continuity: {
        taskId: 'task-release',
        projectId: 'org/repo',
        task: 'Harden the release path',
        status: 'open',
        requirements: ['Keep the 1.9.x version line.'],
        decisions: ['Use the existing release workflow.'],
        verification: [{ content: 'Run the remote CI matrix.', status: 'pending' }],
        risks: ['Do not publish before CI is green.'],
        outcomes: [],
        updatedAt: '2026-09-21T00:00:00.000Z',
        events: [],
      },
      currentFacts: ['Git: clean worktree'],
      startHere: ['package.json'],
      reliableMemory: [],
      cautionMemory: [],
      verificationHints: ['Run the focused smoke.'],
      worktreeDirty: false,
      freshness: { suspect: 0, stale: 0 },
    });

    expect(workset.prompt).toContain('Task continuity');
    expect(workset.prompt).toContain('Keep the 1.9.x version line.');
    expect(workset.prompt).toContain('Run the remote CI matrix.');
    expect(workset.receipt.selected).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'continuity', id: 'continuity:task-release' }),
    ]));
  });
});
