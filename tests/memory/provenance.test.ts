/**
 * Phase 1 Provenance Tests
 *
 * Covers:
 * - sourceDetail / valueCategory schema persistence
 * - Backward-compat: old observations without these fields stay neutral
 * - Session injection source-aware scoring
 * - Retention source-aware decay and immunity
 * - Search result provenance exposure
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: async () => null,
  isVectorSearchAvailable: async () => false,
  isEmbeddingExplicitlyDisabled: () => true,
  resetProvider: () => {},
}));

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { storeObservation, initObservations, getObservation } from '../../src/memory/observations.js';
import { resetDb, searchObservations } from '../../src/store/orama-store.js';
import { isImmune, calculateRelevance, getRetentionZone } from '../../src/memory/retention.js';
import { scoreObservationForSessionContext } from '../../src/memory/session.js';
import type { MemorixDocument, Observation } from '../../src/types.js';

const PROJECT_ID = 'test/provenance';

let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-provenance-'));
  await resetDb();
  await initObservations(testDir);
});

// ── Schema persistence ────────────────────────────────────────────────

describe('Schema persistence', () => {
  it('stores and retrieves sourceDetail=explicit', async () => {
    const { observation } = await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'Use JWT for auth',
      narrative: 'We chose JWT because it is stateless.',
      projectId: PROJECT_ID,
      sourceDetail: 'explicit',
    });
    expect(observation.sourceDetail).toBe('explicit');
    const loaded = getObservation(observation.id);
    expect(loaded?.sourceDetail).toBe('explicit');
  });

  it('stores and retrieves sourceDetail=hook', async () => {
    const { observation } = await storeObservation({
      entityName: 'session',
      type: 'what-changed',
      title: 'Changed auth.ts',
      narrative: 'File edited by agent hook.',
      projectId: PROJECT_ID,
      sourceDetail: 'hook',
    });
    expect(observation.sourceDetail).toBe('hook');
    const loaded = getObservation(observation.id);
    expect(loaded?.sourceDetail).toBe('hook');
  });

  it('stores and retrieves sourceDetail=git-ingest', async () => {
    const { observation } = await storeObservation({
      entityName: 'commit-abc',
      type: 'what-changed',
      title: 'Fix null pointer in parser',
      narrative: 'Commit-backed fact.',
      projectId: PROJECT_ID,
      source: 'git',
      sourceDetail: 'git-ingest',
    });
    expect(observation.sourceDetail).toBe('git-ingest');
    const loaded = getObservation(observation.id);
    expect(loaded?.sourceDetail).toBe('git-ingest');
  });

  it('stores and retrieves valueCategory', async () => {
    const { observation } = await storeObservation({
      entityName: 'arch',
      type: 'decision',
      title: 'Architecture decision',
      narrative: 'This is a core architecture decision with clear rationale.',
      projectId: PROJECT_ID,
      sourceDetail: 'explicit',
      valueCategory: 'core',
    });
    expect(observation.valueCategory).toBe('core');
    const loaded = getObservation(observation.id);
    expect(loaded?.valueCategory).toBe('core');
  });

  it('old observations without sourceDetail have undefined (neutral)', async () => {
    const { observation } = await storeObservation({
      entityName: 'legacy',
      type: 'discovery',
      title: 'Legacy observation without sourceDetail',
      narrative: 'This simulates a pre-1.0.6 observation.',
      projectId: PROJECT_ID,
    });
    expect(observation.sourceDetail).toBeUndefined();
    expect(observation.valueCategory).toBeUndefined();
  });
});

// ── Search result provenance exposure ────────────────────────────────

describe('Search result provenance', () => {
  it('exposes sourceDetail in IndexEntry when set', async () => {
    await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'JWT authentication decision made explicitly',
      narrative: 'We chose JWT because it is stateless and scalable.',
      projectId: PROJECT_ID,
      sourceDetail: 'explicit',
    });

    const entries = await searchObservations({ query: 'JWT authentication', projectId: PROJECT_ID });
    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[0];
    expect(entry.sourceDetail).toBe('explicit');
  });

  it('exposes sourceDetail=hook in IndexEntry', async () => {
    await storeObservation({
      entityName: 'session',
      type: 'what-changed',
      title: 'Hook captured file change in auth module',
      narrative: 'Automated hook capture of file modification.',
      projectId: PROJECT_ID,
      sourceDetail: 'hook',
    });

    const entries = await searchObservations({ query: 'hook captured auth module', projectId: PROJECT_ID });
    expect(entries.length).toBeGreaterThan(0);
    const hookEntry = entries.find(e => e.sourceDetail === 'hook');
    expect(hookEntry).toBeDefined();
  });

  it('exposes valueCategory in IndexEntry when set', async () => {
    await storeObservation({
      entityName: 'core-arch',
      type: 'decision',
      title: 'Core architecture pattern for data pipeline',
      narrative: 'Fundamental design decision for the data processing pipeline.',
      projectId: PROJECT_ID,
      sourceDetail: 'explicit',
      valueCategory: 'core',
    });

    const entries = await searchObservations({ query: 'core architecture data pipeline', projectId: PROJECT_ID });
    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[0];
    expect(entry.valueCategory).toBe('core');
  });

  it('undefined sourceDetail/valueCategory does not pollute IndexEntry with empty string', async () => {
    await storeObservation({
      entityName: 'plain',
      type: 'discovery',
      title: 'Plain observation without provenance fields',
      narrative: 'A simple observation with no extra provenance metadata.',
      projectId: PROJECT_ID,
    });

    const entries = await searchObservations({ query: 'plain observation provenance metadata', projectId: PROJECT_ID });
    expect(entries.length).toBeGreaterThan(0);
    // sourceDetail and valueCategory should be undefined (not empty string '')
    expect(entries[0].sourceDetail).toBeUndefined();
    expect(entries[0].valueCategory).toBeUndefined();
  });
});

// ── Retention source-aware decay ─────────────────────────────────────

describe('Retention source-aware decay', () => {
  function makeDoc(overrides: Partial<MemorixDocument>): MemorixDocument {
    return {
      id: 'obs-1',
      observationId: 1,
      entityName: 'test',
      type: 'what-changed',
      title: 'Test',
      narrative: 'Test narrative',
      facts: '',
      filesModified: '',
      concepts: '',
      tokens: 50,
      createdAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(), // 25 days old
      projectId: PROJECT_ID,
      accessCount: 0,
      lastAccessedAt: '',
      status: 'active',
      source: 'agent',
      ...overrides,
    };
  }

  it('hook observations decay faster than neutral (same type, same age)', () => {
    const neutral = makeDoc({ sourceDetail: '' });
    const hook = makeDoc({ sourceDetail: 'hook' });

    const neutralScore = calculateRelevance(neutral).totalScore;
    const hookScore = calculateRelevance(hook).totalScore;

    expect(hookScore).toBeLessThan(neutralScore);
  });

  it('git-ingest observations decay slower than neutral (same type, same age)', () => {
    const neutral = makeDoc({ sourceDetail: '' });
    const git = makeDoc({ sourceDetail: 'git-ingest' });

    const neutralScore = calculateRelevance(neutral).totalScore;
    const gitScore = calculateRelevance(git).totalScore;

    expect(gitScore).toBeGreaterThan(neutralScore);
  });

  it('hook observations become archive-candidate sooner than neutral', () => {
    // 20 days old — within neutral retention (low=30d) but beyond hook retention (15d)
    const docBase = {
      type: 'discovery' as const, // importance=low, retentionDays=30 → hook gets 15
      createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const neutral = makeDoc({ ...docBase, sourceDetail: '' });
    const hook = makeDoc({ ...docBase, sourceDetail: 'hook' });

    expect(getRetentionZone(neutral)).not.toBe('archive-candidate');
    expect(getRetentionZone(hook)).toBe('archive-candidate');
  });

  it('valueCategory=core grants immunity regardless of type', () => {
    // discovery with low importance would not normally be immune
    const lowImportance = makeDoc({ type: 'discovery', sourceDetail: 'explicit', valueCategory: '' });
    const coreMemory = makeDoc({ type: 'discovery', sourceDetail: 'explicit', valueCategory: 'core' });

    expect(isImmune(lowImportance)).toBe(false);
    expect(isImmune(coreMemory)).toBe(true);
  });

  it('undefined sourceDetail applies neutral multiplier (backward-compat)', () => {
    const withUndefined = makeDoc({ sourceDetail: undefined });
    const withEmpty = makeDoc({ sourceDetail: '' });

    const scoreUndefined = calculateRelevance(withUndefined).totalScore;
    const scoreEmpty = calculateRelevance(withEmpty).totalScore;

    expect(scoreUndefined).toBeCloseTo(scoreEmpty, 5);
  });
});

// ── Session injection source-aware scoring (direct) ─────────────────

function makeObs(overrides: Partial<Observation>): Observation {
  return {
    id: 1,
    entityName: 'test',
    type: 'gotcha',
    title: 'Test observation',
    narrative: 'Test narrative for scoring.',
    facts: [],
    filesModified: [],
    concepts: [],
    tokens: 50,
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days old
    projectId: PROJECT_ID,
    revisionCount: 1,
    status: 'active',
    hasCausalLanguage: false,
    ...overrides,
  };
}

describe('Session injection source-aware scoring', () => {
  it('hook scores lower than explicit (same type, same age, same content)', () => {
    const explicit = makeObs({ sourceDetail: 'explicit' });
    const hook = makeObs({ sourceDetail: 'hook' });

    const scoreExplicit = scoreObservationForSessionContext(explicit, []);
    const scoreHook = scoreObservationForSessionContext(hook, []);

    expect(scoreHook).toBeLessThan(scoreExplicit);
    expect(scoreExplicit - scoreHook).toBeGreaterThanOrEqual(3); // exact delta from session.ts
  });

  it('hook+ephemeral scores lower than hook alone (compound penalty)', () => {
    const hook = makeObs({ sourceDetail: 'hook', valueCategory: undefined });
    const hookEphemeral = makeObs({ sourceDetail: 'hook', valueCategory: 'ephemeral' });

    const scoreHook = scoreObservationForSessionContext(hook, []);
    const scoreHookEphemeral = scoreObservationForSessionContext(hookEphemeral, []);

    expect(scoreHookEphemeral).toBeLessThan(scoreHook);
    expect(scoreHook - scoreHookEphemeral).toBeCloseTo(5, 6); // tolerate platform float differences
  });

  it('core boosts above neutral/undefined (same type, same age)', () => {
    const neutral = makeObs({ sourceDetail: 'explicit', valueCategory: undefined });
    const core = makeObs({ sourceDetail: 'explicit', valueCategory: 'core' });

    const scoreNeutral = scoreObservationForSessionContext(neutral, []);
    const scoreCore = scoreObservationForSessionContext(core, []);

    expect(scoreCore).toBeGreaterThan(scoreNeutral);
    expect(scoreCore - scoreNeutral).toBeCloseTo(2, 6); // +2 from session.ts, tolerate FP drift
  });

  it('ordering: explicit > hook > hook+ephemeral', () => {
    const explicit = makeObs({ sourceDetail: 'explicit' });
    const hook = makeObs({ sourceDetail: 'hook' });
    const hookEphemeral = makeObs({ sourceDetail: 'hook', valueCategory: 'ephemeral' });

    const scores = [explicit, hook, hookEphemeral].map(o =>
      scoreObservationForSessionContext(o, []),
    );

    expect(scores[0]).toBeGreaterThan(scores[1]); // explicit > hook
    expect(scores[1]).toBeGreaterThan(scores[2]); // hook > hook+ephemeral
  });
});
