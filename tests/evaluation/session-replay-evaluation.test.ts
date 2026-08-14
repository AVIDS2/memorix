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
 * The retrieval exam: a fixed set of questions asked against a fixed set of
 * seeded memories, run through the REAL search path agents use.
 *
 * Baseline policy (eval-first): pin the CURRENT scores here before touching
 * retrieval code. A later change may only update these constants when the
 * new measured scores are at least as good — hit rate and budget must never
 * regress, and the duplicate rate is the target of the dedup change.
 */

const projectId = 'eval/session-replay';
const originalEmbedding = process.env.MEMORIX_EMBEDDING;
let sandbox = '';

/** Baseline measured on 1.4.5 — updated only when a change measurably improves it. */
const BASELINE_DUPLICATE_RATE = 0.5454545454545454; // 6 duplicate shows of 11 total

const TOKEN_CEILING = 800;

const questions: SessionReplayQuestion[] = [
  { id: 'auth-validate', query: 'where does token validation live', expectedObsIds: [] },
  { id: 'auth-refresh', query: 'how does the auth token refresh flow work', expectedObsIds: [] },
  { id: 'config-staging', query: 'config migration staged rollout default', expectedObsIds: [] },
  { id: 'release-checklist', query: 'release blocker verification checklist', expectedObsIds: [] },
];

async function seedKnownMemories(): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  const seeds: Array<{ key: string; title: string; narrative: string; entity: string }> = [
    {
      key: 'auth-token',
      title: 'Token validation lives at the auth boundary',
      narrative: 'Token validation is owned by the auth boundary. Start from the focused auth token test before touching the flow.',
      entity: 'auth',
    },
    {
      key: 'auth-refresh',
      title: 'Auth refresh rotates tokens every ten minutes',
      narrative: 'The auth refresh flow rotates tokens every ten minutes and must be replayed in tests with the refresh fixture.',
      entity: 'auth',
    },
    {
      key: 'config-staging',
      title: 'Config migration keeps the staged rollout default',
      narrative: 'Config migration keeps staged rollout as the default and the migration test asserts the staged flag.',
      entity: 'config',
    },
    {
      key: 'release-checklist',
      title: 'Release verification checklist',
      narrative: 'Before publishing, run the focused package smoke and the packed-package check, then confirm CI on the release commit.',
      entity: 'release',
    },
    {
      key: 'distractor',
      title: 'Old refactor from the previous quarter',
      narrative: 'An unrelated refactor note about a component that no longer exists in this project.',
      entity: 'legacy',
    },
  ];

  for (const seed of seeds) {
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

describe('session replay retrieval exam (baseline)', () => {
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

  it('scores the current retrieval behavior on the fixed exam', async () => {
    process.env.MEMORIX_EMBEDDING = 'off';
    await initObservationStore(path.join(sandbox, 'data'));
    await initObservations(path.join(sandbox, 'data'));
    const ids = await seedKnownMemories();

    const examQuestions: SessionReplayQuestion[] = [
      { id: 'auth-validate', query: 'where does token validation live', expectedObsIds: [ids.get('auth-token')!] },
      { id: 'auth-refresh', query: 'how does the auth token refresh flow work', expectedObsIds: [ids.get('auth-refresh')!] },
      { id: 'config-staging', query: 'config migration staged rollout default', expectedObsIds: [ids.get('config-staging')!] },
      { id: 'release-checklist', query: 'release blocker verification checklist', expectedObsIds: [ids.get('release-checklist')!] },
    ];

    const turns = [];
    for (const question of examQuestions) {
      const result = await compactSearch({
        query: question.query,
        limit: 5,
        projectId,
        reader: { projectId },
      }, 'mcp');
      turns.push({
        questionId: question.id,
        shownObsIds: result.entries.map((entry) => entry.id),
        tokens: result.totalTokens,
      });
    }

    const scores = scoreSessionReplay(examQuestions, turns, TOKEN_CEILING);
    // eslint-disable-next-line no-console
    console.log('\n' + formatSessionReplayScoreboard(scores, '1.4.5 baseline'));

    // Invariants that must hold before AND after any retrieval change.
    expect(scores.hitRate, JSON.stringify(scores)).toBe(1);
    expect(scores.overBudgetTurns, JSON.stringify(scores)).toBe(0);
    // Baseline pin: the duplicate rate the dedup change must lower.
    expect(scores.duplicateRate, JSON.stringify(scores)).toBe(BASELINE_DUPLICATE_RATE);
  });
});
