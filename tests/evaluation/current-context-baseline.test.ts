import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildAutoProjectBrief,
  buildAutoProjectContext,
  formatAutoProjectContextPrompt,
} from '../../src/codegraph/auto-context.js';
import { getAllObservations, initObservations, storeObservation } from '../../src/memory/observations.js';
import { initObservationStore, resetObservationStore } from '../../src/store/obs-store.js';
import { resetDb } from '../../src/store/orama-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import {
  compareWorksets,
  type EvaluatedWorkset,
} from '../../src/evaluation/workset-evaluation.js';
import { WORKSET_EVALUATION_FIXTURES } from './workset-fixtures.js';

const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/workset-evaluation');
const projectId = 'evaluation/current-context';
const originalEmbedding = process.env.MEMORIX_EMBEDDING;
let sandboxRoot = '';

function makeSandbox(fixtureId: string): { repoDir: string; dataDir: string } {
  const fixture = WORKSET_EVALUATION_FIXTURES.find(item => item.id === fixtureId)!;
  sandboxRoot = mkdtempSync(path.join(tmpdir(), 'memorix-workset-baseline-'));
  const repoDir = path.join(sandboxRoot, 'repo');
  const dataDir = path.join(sandboxRoot, 'data');
  cpSync(path.join(fixtureRoot, fixture.repositoryPath), repoDir, { recursive: true });
  execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
  return { repoDir, dataDir };
}

function asCurrentWorkset(input: {
  prompt: string;
  startHere: string[];
  evidenceIds: string[];
  dirty: boolean;
}): EvaluatedWorkset {
  return {
    variant: 'current-context',
    prompt: input.prompt,
    startHere: input.startHere,
    evidenceIds: input.evidenceIds,
    cautions: input.dirty ? ['dirty-worktree'] : [],
  };
}

afterEach(async () => {
  if (originalEmbedding === undefined) {
    delete process.env.MEMORIX_EMBEDDING;
  } else {
    process.env.MEMORIX_EMBEDDING = originalEmbedding;
  }
  resetObservationStore();
  await resetDb();
  closeAllDatabases();
  if (sandboxRoot) rmSync(sandboxRoot, { recursive: true, force: true });
  sandboxRoot = '';
});

describe('current Project Context evaluation baseline', () => {
  it('produces a source-backed current baseline for a TypeScript fixture', async () => {
    const fixture = WORKSET_EVALUATION_FIXTURES.find(item => item.id === 'typescript-auth')!;
    const { repoDir, dataDir } = makeSandbox(fixture.id);
    process.env.MEMORIX_EMBEDDING = 'off';
    await initObservationStore(dataDir);
    await initObservations(dataDir);
    await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'Token validation is owned by the auth boundary',
      narrative: 'Start with src/auth.ts and reproduce the focused test first.',
      filesModified: ['src/auth.ts'],
      projectId,
    });
    const observation = getAllObservations().find(
      item => item.projectId === projectId && item.title === 'Token validation is owned by the auth boundary',
    )!;

    const context = await buildAutoProjectContext({
      project: { id: projectId, name: 'typescript-auth', rootPath: repoDir },
      dataDir,
      observations: getAllObservations(),
      task: fixture.task,
      refresh: 'auto',
    });
    const brief = buildAutoProjectBrief(context);
    const expected = {
      ...fixture,
      expectation: {
        ...fixture.expectation,
        requiredEvidenceIds: ['obs:' + observation.id],
      },
    };
    const result = compareWorksets(expected, [asCurrentWorkset({
      prompt: formatAutoProjectContextPrompt(context),
      startHere: brief.startHere,
      evidenceIds: brief.reliableMemoryIds.map(id => 'obs:' + id),
      dirty: context.currentFacts.git.dirty,
    })]).byVariant['current-context']!;

    expect(context.overview.code.languages).toEqual([{ language: 'typescript', files: 2 }]);
    expect(result.passed, JSON.stringify(result)).toBe(true);
  });

  it('keeps an uncommitted worktree visible in the current baseline', async () => {
    const fixture = WORKSET_EVALUATION_FIXTURES.find(item => item.id === 'dirty-worktree')!;
    const { repoDir, dataDir } = makeSandbox(fixture.id);
    process.env.MEMORIX_EMBEDDING = 'off';
    await initObservationStore(dataDir);
    await initObservations(dataDir);
    await storeObservation({
      entityName: 'config',
      type: 'what-changed',
      title: 'Config migration keeps staged rollout behavior',
      narrative: 'Continue from src/config.ts and preserve the staged default.',
      filesModified: ['src/config.ts'],
      projectId,
    });
    const observation = getAllObservations().find(
      item => item.projectId === projectId && item.title === 'Config migration keeps staged rollout behavior',
    )!;

    const context = await buildAutoProjectContext({
      project: { id: projectId, name: 'dirty-worktree', rootPath: repoDir },
      dataDir,
      observations: getAllObservations(),
      task: fixture.task,
      refresh: 'auto',
    });
    const brief = buildAutoProjectBrief(context);
    const expected = {
      ...fixture,
      expectation: {
        ...fixture.expectation,
        requiredEvidenceIds: ['obs:' + observation.id],
      },
    };
    const result = compareWorksets(expected, [asCurrentWorkset({
      prompt: formatAutoProjectContextPrompt(context),
      startHere: brief.startHere,
      evidenceIds: brief.reliableMemoryIds.map(id => 'obs:' + id),
      dirty: context.currentFacts.git.dirty,
    })]).byVariant['current-context']!;

    expect(context.currentFacts.git.dirty).toBe(true);
    expect(result.passed, JSON.stringify(result)).toBe(true);
  });
});
