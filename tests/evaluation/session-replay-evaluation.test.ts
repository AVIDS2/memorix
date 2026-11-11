import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compactSearch } from '../../src/compact/engine.js';
import { initObservations, storeObservation } from '../../src/memory/observations.js';
import { initObservationStore, resetObservationStore } from '../../src/store/obs-store.js';
import { resetDb } from '../../src/store/orama-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import {
  formatSessionReplayScoreboard,
  scoreSessionReplay,
  type SessionReplayQuestion,
} from '../../src/evaluation/session-replay.js';

/**
 * The retrieval exam: a fixed question session asked against a fixed set of
 * seeded memories, run through the REAL search path agents use.
 *
 * Eval-first policy: pin the CURRENT scores here before touching retrieval
 * code. A later change may only move these constants when the new measured
 * scores are at least as good — hit rate and budget must never regress, and
 * the duplicate rate is the target of the session-dedup change.
 */

const projectId = 'eval/session-replay';
const originalEmbedding = process.env.MEMORIX_EMBEDDING;
let sandbox = '';

const LIMIT = 4;
const TOKEN_CEILING = 800;

/**
 * 1.4.5 baseline without session dedup (no surfacedIds passed):
 * measured below, pinned after the first run.
 */
const BASELINE_DUPLICATE_RATE = 0.25; // 4 duplicate shows of 16 total, measured on 1.4.5
/** Achieved with session dedup (demote surfaced ids ×0.5): 3 of 16 shows. */
const DEDUP_DUPLICATE_RATE = 0.1875;

interface Seed {
  key: string;
  title: string;
  narrative: string;
  entity: string;
}

const ANSWER_SEEDS: Seed[] = [
  {
    key: 'auth-token',
    title: 'Token validation lives at the auth boundary',
    narrative: 'Token validation is owned by the auth boundary and starts from the focused auth token test.',
    entity: 'auth',
  },
  {
    key: 'auth-refresh',
    title: 'Auth refresh rotates credentials every ten minutes',
    narrative: 'The refresh flow rotates credentials every ten minutes and replays the refresh fixture in tests.',
    entity: 'auth',
  },
  {
    key: 'config-staging',
    title: 'Config migration keeps the staged rollout default',
    narrative: 'Config migration keeps staged rollout as the default and asserts the staged flag.',
    entity: 'config',
  },
  {
    key: 'release-checklist',
    title: 'Release verification checklist',
    narrative: 'Before publishing, run the focused package smoke and the packed-package check, then confirm CI on the release commit.',
    entity: 'release',
  },
];

/** Noise that shares vocabulary with the answers but is not the answer,
 *  so every turn has real competition for its 4 slots. */
const DISTRACTOR_SEEDS: Seed[] = [
  { key: 'd1', title: 'Auth token migration from the legacy system', narrative: 'The old auth token format was retired.', entity: 'legacy' },
  { key: 'd2', title: 'Config fallback behavior in staging', narrative: 'The old config fallback in staging is gone.', entity: 'legacy' },
  { key: 'd3', title: 'Release candidate naming convention', narrative: 'Release candidate names from the old release process.', entity: 'legacy' },
  { key: 'd4', title: 'Checklist for the old deploy pipeline', narrative: 'A checklist for the old deploy pipeline.', entity: 'legacy' },
  { key: 'd5', title: 'Validation order in the legacy auth module', narrative: 'The legacy auth validation order.', entity: 'legacy' },
  { key: 'd6', title: 'Refresh endpoint logging in the old gateway', narrative: 'Logging of the legacy gateway refresh endpoint.', entity: 'legacy' },
  { key: 'd7', title: 'Rollout flags used by the retired feature', narrative: 'Rollout flags from a retired feature.', entity: 'legacy' },
  { key: 'd8', title: 'Migration steps for the previous config format', narrative: 'Migration steps for the previous config format.', entity: 'legacy' },
  { key: 'd9', title: 'Publishing notes from the last quarter', narrative: 'Notes about the publishing cadence last quarter.', entity: 'legacy' },
  { key: 'd10', title: 'Credentials rotation in the legacy service', narrative: 'The legacy service credentials rotation.', entity: 'legacy' },
];

const ALL_SEEDS = [...ANSWER_SEEDS, ...DISTRACTOR_SEEDS];

async function seedKnownMemories(): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const seed of ALL_SEEDS) {
    const result = await storeObservation({
      entityName: seed.entity,
      type: 'how-it-works',
      title: seed.title,
      narrative: seed.narrative,
      projectId,
      source: 'manual',
    });
    ids.set(seed.key, result.observation.id);
  }
  return ids;
}

function buildQuestions(ids: Map<string, number>): SessionReplayQuestion[] {
  return [
    { id: 'auth-validate', query: 'where does token validation live', expectedObsIds: [ids.get('auth-token')!] },
    { id: 'auth-refresh', query: 'how does the auth refresh rotate credentials', expectedObsIds: [ids.get('auth-refresh')!] },
    { id: 'config-staging', query: 'config migration staged rollout default', expectedObsIds: [ids.get('config-staging')!] },
    { id: 'release-checklist', query: 'release verification checklist before publishing', expectedObsIds: [ids.get('release-checklist')!] },
  ];
}

describe('session replay retrieval exam', () => {
  beforeEach(() => {
    sandbox = mkdtempSync(path.join(tmpdir(), 'memorix-session-replay-'));
  });

  afterEach(async () => {
    if (originalEmbedding === undefined) delete process.env.MEMORIX_EMBEDDING;
    else process.env.MEMORIX_EMBEDDING = originalEmbedding;
    resetObservationStore();
    await resetDb();
    closeAllDatabases();
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
    sandbox = '';
  });

  async function runExam(useSurfacedDedup: boolean): Promise<ReturnType<typeof scoreSessionReplay>> {
    process.env.MEMORIX_EMBEDDING = 'off';
    await initObservationStore(path.join(sandbox, 'data'));
    await initObservations(path.join(sandbox, 'data'));
    const ids = await seedKnownMemories();
    const questions = buildQuestions(ids);

    const turns = [];
    const surfaced = new Set<number>();
    for (const question of questions) {
      const result = await compactSearch({
        query: question.query,
        limit: LIMIT,
        projectId,
        reader: { projectId },
        ...(useSurfacedDedup ? { surfacedIds: [...surfaced] } : {}),
      }, 'mcp');
      const shownIds = result.entries.map((entry) => entry.id);
      turns.push({
        questionId: question.id,
        shownObsIds: shownIds,
        tokens: result.totalTokens,
      });
      for (const id of shownIds) surfaced.add(id);
    }

    return scoreSessionReplay(questions, turns, TOKEN_CEILING);
  }

  it('baseline: scores current retrieval without session dedup', async () => {
    const scores = await runExam(false);
    // eslint-disable-next-line no-console
    console.log('\n' + formatSessionReplayScoreboard(scores, '1.4.5 baseline (no dedup)'));
    expect(scores.hitRate, JSON.stringify(scores)).toBe(1);
    expect(scores.overBudgetTurns, JSON.stringify(scores)).toBe(0);
    expect(scores.duplicateRate, JSON.stringify(scores)).toBe(BASELINE_DUPLICATE_RATE);
  });

  it('dedup: lower duplicate rate with hits intact when surfaced ids are demoted', async () => {
    const scores = await runExam(true);
    // eslint-disable-next-line no-console
    console.log('\n' + formatSessionReplayScoreboard(scores, 'with session dedup (demote surfaced)'));
    expect(scores.hitRate, JSON.stringify(scores)).toBe(1);
    expect(scores.overBudgetTurns, JSON.stringify(scores)).toBe(0);
    expect(scores.duplicateRate, JSON.stringify(scores)).toBeLessThan(BASELINE_DUPLICATE_RATE);
    expect(scores.duplicateRate, JSON.stringify(scores)).toBe(DEDUP_DUPLICATE_RATE);
  });
});
