import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildAutoProjectContext,
  formatAutoProjectContextPrompt,
} from '../../src/codegraph/auto-context.js';
import { initObservations, storeObservation, getAllObservations } from '../../src/memory/observations.js';
import { initObservationStore, resetObservationStore } from '../../src/store/obs-store.js';
import { resetDb } from '../../src/store/orama-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { initSessionStore, resetSessionStore } from '../../src/store/session-store.js';
import { startSession, endSession } from '../../src/memory/session.js';

/**
 * The "memory-native" exam: whatever the task, the brief must always carry
 * a small who-you-are + what-this-workspace-is-doing block — the profile,
 * the latest session state, and recent durable facts — without blowing the
 * token budget. Baseline: the block does not exist at all.
 */

const projectId = 'eval/always-on';
const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/workset-evaluation');
const originalEmbedding = process.env.MEMORIX_EMBEDDING;
let sandboxRoot = '';

function makeSandbox(): { repoDir: string; dataDir: string } {
  sandboxRoot = mkdtempSync(path.join(tmpdir(), 'memorix-always-on-'));
  const repoDir = path.join(sandboxRoot, 'repo');
  const dataDir = path.join(sandboxRoot, 'data');
  cpSync(path.join(fixtureRoot, 'typescript-auth'), repoDir, { recursive: true });
  execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
  return { repoDir, dataDir };
}

afterEach(async () => {
  if (originalEmbedding === undefined) delete process.env.MEMORIX_EMBEDDING;
  else process.env.MEMORIX_EMBEDDING = originalEmbedding;
  resetObservationStore();
  resetSessionStore();
  await resetDb();
  closeAllDatabases();
  if (sandboxRoot) rmSync(sandboxRoot, { recursive: true, force: true });
  sandboxRoot = '';
});

describe('always-on brief block exam', () => {
  let repoDir = '';
  let dataDir = '';

  beforeEach(async () => {
    ({ repoDir, dataDir } = makeSandbox());
    process.env.MEMORIX_EMBEDDING = 'off';
    await initObservationStore(dataDir);
    await initObservations(dataDir);
    await initSessionStore(dataDir);

    await storeObservation({
      entityName: 'user-profile',
      type: 'how-it-works',
      title: 'The user is preparing for the graduate entrance exam',
      narrative: 'The user is preparing for the graduate entrance exam and uses this workspace to research thesis topics.',
      projectId,
      visibility: 'personal',
      createdByAgentId: 'exam-agent',
      source: 'manual',
    });

    const started = await startSession(dataDir, projectId, { agent: 'claude' });
    const session = started.session;
    await endSession(dataDir, session.id, 'Reviewed paper topics and shortlisted two research directions.');

    const { createManualLongTermMemory, qualifyLongTermMemory, approveLongTermMemory } = await import('../../src/memory/long-term.js');
    const created = await createManualLongTermMemory({
      dataDir,
      projectId,
      kind: 'semantic',
      scope: 'project',
      title: 'Thesis direction: agent memory systems',
      content: 'The research topic focuses on memory systems for coding agents.',
      reader: { projectId },
    });
    await qualifyLongTermMemory({ dataDir, id: created.memory.id, reason: 'exam seed' });
    await approveLongTermMemory({ dataDir, id: created.memory.id, reason: 'exam seed' });
  });

  it('carries profile, workspace state, and durable facts for an unrelated task', async () => {
    const context = await buildAutoProjectContext({
      project: { id: projectId, name: 'typescript-auth', rootPath: repoDir },
      dataDir,
      observations: getAllObservations(),
      reader: { projectId, agentId: 'exam-agent' },
      task: 'fix the unrelated lint warning in src/auth.ts',
      refresh: 'auto',
    });
    const prompt = formatAutoProjectContextPrompt(context);

    // eslint-disable-next-line no-console
    console.log('\nAlways-on exam prompt (first 700 chars):\n' + prompt.slice(0, 700));

    expect(prompt, 'profile must always be present').toContain('graduate entrance exam');
    expect(prompt, 'latest session state must always be present').toContain('paper topics');
    expect(prompt, 'durable facts must always be present').toContain('Thesis direction');
    expect(context.workset.budget.tokenCount).toBeLessThanOrEqual(context.workset.budget.maxTokens);
  });
});
