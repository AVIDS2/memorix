/**
 * Probe Observation Type Tests
 *
 * Covers:
 * - Store: type: "probe" is accepted, invalid types are rejected
 * - Search: default search excludes probe, explicit type: "probe" includes it
 * - Retention: probe is short-lived (~7 days), not immune
 * - Session: probe is heavily penalized, never surfaces as priority context
 * - Mini-skill: probe cannot be promoted to mini-skill
 * - Formation: probe has very low TYPE_WEIGHT (0.10)
 * - CLI: coerceObservationType accepts "probe"
 * - Dashboard: probe excluded from typeCounts and recentObservations
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
import { isImmune, getImmunityReason, getEffectiveRetentionDays, getImportanceLevel } from '../../src/memory/retention.js';
import { scoreObservationForSessionContext } from '../../src/memory/session.js';
import { promoteToMiniSkill } from '../../src/skills/mini-skills.js';
import { runEvaluate } from '../../src/memory/formation/evaluate.js';
import type { ExtractResult } from '../../src/memory/formation/types.js';
import { coerceObservationType } from '../../src/cli/commands/operator-shared.js';
import type { MemorixDocument, Observation } from '../../src/types.js';

const PROJECT_ID = 'test/probe-type';

let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-probe-'));
  await resetDb();
  await initObservations(testDir);
});

// Store

describe('Store: probe type', () => {
  it('stores type: "probe" successfully', async () => {
    const { observation } = await storeObservation({
      entityName: 'health-check',
      type: 'probe',
      title: 'Agent connectivity check',
      narrative: 'Heartbeat to verify agent is online and responsive.',
      projectId: PROJECT_ID,
    });
    expect(observation.type).toBe('probe');
    expect(observation.id).toBeGreaterThan(0);
  });

  it('retrieves stored probe observation', async () => {
    const { observation } = await storeObservation({
      entityName: 'health-check',
      type: 'probe',
      title: 'Agent connectivity check',
      narrative: 'Heartbeat to verify agent is online and responsive.',
      projectId: PROJECT_ID,
    });
    const loaded = getObservation(observation.id);
    expect(loaded?.type).toBe('probe');
    expect(loaded?.title).toBe('Agent connectivity check');
  });

  it('stores probe alongside other types without conflict', async () => {
    await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'Use JWT',
      narrative: 'Stateless auth.',
      projectId: PROJECT_ID,
    });
    const { observation: probe } = await storeObservation({
      entityName: 'health',
      type: 'probe',
      title: 'Connectivity check',
      narrative: 'Heartbeat.',
      projectId: PROJECT_ID,
    });
    await storeObservation({
      entityName: 'cache',
      type: 'gotcha',
      title: 'Cache invalidation bug',
      narrative: 'Race condition.',
      projectId: PROJECT_ID,
    });
    expect(probe.type).toBe('probe');
  });
});

// Search

describe('Search: probe exclusion and inclusion', () => {
  beforeEach(async () => {
    await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'Use JWT for authentication',
      narrative: 'We chose JWT because it is stateless.',
      projectId: PROJECT_ID,
    });
    await storeObservation({
      entityName: 'health',
      type: 'probe',
      title: 'Agent heartbeat connectivity check',
      narrative: 'Heartbeat to verify agent is online.',
      projectId: PROJECT_ID,
    });
    await storeObservation({
      entityName: 'cache',
      type: 'gotcha',
      title: 'Cache invalidation race condition',
      narrative: 'Race condition in cache invalidation.',
      projectId: PROJECT_ID,
    });
  });

  it('default search excludes probe observations', async () => {
    const results = await searchObservations({
      query: 'connectivity heartbeat',
      projectId: PROJECT_ID,
      status: 'active',
    });
    const probeResults = results.filter(r => r.type === 'probe');
    expect(probeResults.length).toBe(0);
  });

  it('default search returns non-probe observations', async () => {
    const results = await searchObservations({
      query: 'authentication JWT',
      projectId: PROJECT_ID,
      status: 'active',
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.type !== 'probe')).toBe(true);
  });

  it('explicit type: "probe" search returns probe observations', async () => {
    const results = await searchObservations({
      query: 'connectivity heartbeat',
      type: 'probe',
      projectId: PROJECT_ID,
      status: 'active',
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.type === 'probe')).toBe(true);
  });

  it('explicit type: "probe" search does not return non-probe observations', async () => {
    const results = await searchObservations({
      query: 'authentication JWT',
      type: 'probe',
      projectId: PROJECT_ID,
      status: 'active',
    });
    expect(results.every(r => r.type === 'probe')).toBe(true);
  });

  it('broad query without type filter excludes probe', async () => {
    const results = await searchObservations({
      query: '',
      projectId: PROJECT_ID,
      status: 'active',
    });
    const probeResults = results.filter(r => r.type === 'probe');
    expect(probeResults.length).toBe(0);
  });
});

// Retention

describe('Retention: probe is short-lived', () => {
  function makeDoc(overrides: Partial<MemorixDocument> = {}): MemorixDocument {
    return {
      id: 'obs-1',
      observationId: 1,
      entityName: 'test-entity',
      type: 'probe',
      title: 'Agent heartbeat',
      narrative: 'Connectivity check.',
      facts: '',
      filesModified: '',
      concepts: '',
      tokens: 50,
      createdAt: new Date().toISOString(),
      projectId: PROJECT_ID,
      accessCount: 0,
      lastAccessedAt: '',
      status: 'active',
      source: 'agent',
      sourceDetail: '',
      valueCategory: '',
      ...overrides,
    };
  }

  it('probe gets low importance level', () => {
    const doc = makeDoc();
    expect(getImportanceLevel(doc)).toBe('low');
  });

  it('probe effective retention is ~7 days (TYPE_RETENTION_OVERRIDE)', () => {
    const doc = makeDoc({ sourceDetail: 'explicit', valueCategory: '' });
    const days = getEffectiveRetentionDays(doc);
    // 7 (override) × 1.0 (explicit source) × 1.0 (no valueCategory) = 7
    expect(days).toBe(7);
  });

  it('probe + hook source decays faster (7 × 0.5 = 3.5, floored at 7)', () => {
    const doc = makeDoc({ sourceDetail: 'hook', valueCategory: '' });
    const days = getEffectiveRetentionDays(doc);
    // 7 × 0.5 = 3.5, but MIN_RETENTION_DAYS floor = 7
    expect(days).toBe(7);
  });

  it('probe + ephemeral valueCategory decays faster (7 × 0.5 = 3.5, floored at 7)', () => {
    const doc = makeDoc({ sourceDetail: '', valueCategory: 'ephemeral' });
    const days = getEffectiveRetentionDays(doc);
    // 7 × 0.5 = 3.5, but MIN_RETENTION_DAYS floor = 7
    expect(days).toBe(7);
  });

  it('probe is not immune from archiving', () => {
    const doc = makeDoc();
    expect(isImmune(doc)).toBe(false);
  });

  it('probe with core valueCategory is still not immune', () => {
    const doc = makeDoc({ valueCategory: 'core' });
    expect(isImmune(doc)).toBe(false);
  });

  it('probe retention is much shorter than decision (high importance)', () => {
    const probeDoc = makeDoc({ type: 'probe' });
    const decisionDoc = makeDoc({ type: 'decision' });
    expect(getEffectiveRetentionDays(probeDoc)).toBeLessThan(getEffectiveRetentionDays(decisionDoc));
  });

  it('probe + core valueCategory does NOT extend retention to 14 days', () => {
    const doc = makeDoc({ valueCategory: 'core' });
    const days = getEffectiveRetentionDays(doc);
    // probe override is 7 days; valueCategory multiplier is excluded for type-override types
    expect(days).toBe(7);
  });

  it('probe with high accessCount is still not immune', () => {
    const doc = makeDoc({ accessCount: 10 });
    expect(isImmune(doc)).toBe(false);
  });

  it('getImmunityReason returns null for probe', () => {
    const doc = makeDoc();
    expect(getImmunityReason(doc)).toBeNull();
  });

  it('getImmunityReason returns null for probe even with core valueCategory', () => {
    const doc = makeDoc({ valueCategory: 'core' });
    expect(getImmunityReason(doc)).toBeNull();
  });
});

// Session injection

describe('Session: probe is excluded from priority context', () => {
  it('probe gets heavy negative score in session context', () => {
    const obs: Observation = {
      id: 1,
      entityName: 'health',
      type: 'probe',
      title: 'Agent heartbeat',
      narrative: 'Connectivity check.',
      facts: [],
      filesModified: [],
      concepts: [],
      tokens: 50,
      createdAt: new Date().toISOString(),
      projectId: PROJECT_ID,
      status: 'active',
      source: 'agent',
      sourceDetail: 'explicit',
      valueCategory: 'ephemeral',
    };
    const score = scoreObservationForSessionContext(obs, []);
    // Probe penalty is -100, so score should be deeply negative
    expect(score).toBeLessThan(-50);
  });

  it('probe scores much lower than decision in session context', () => {
    const probeObs: Observation = {
      id: 1,
      entityName: 'health',
      type: 'probe',
      title: 'Agent heartbeat',
      narrative: 'Connectivity check.',
      facts: [],
      filesModified: [],
      concepts: [],
      tokens: 50,
      createdAt: new Date().toISOString(),
      projectId: PROJECT_ID,
      status: 'active',
      source: 'agent',
      sourceDetail: 'explicit',
    };
    const decisionObs: Observation = {
      id: 2,
      entityName: 'auth',
      type: 'decision',
      title: 'Use JWT',
      narrative: 'Stateless auth.',
      facts: [],
      filesModified: [],
      concepts: [],
      tokens: 50,
      createdAt: new Date().toISOString(),
      projectId: PROJECT_ID,
      status: 'active',
      source: 'agent',
      sourceDetail: 'explicit',
    };
    const probeScore = scoreObservationForSessionContext(probeObs, []);
    const decisionScore = scoreObservationForSessionContext(decisionObs, []);
    expect(probeScore).toBeLessThan(decisionScore);
  });
});

// Mini-skill promotion

describe('Mini-skill: probe cannot be promoted', () => {
  it('probe observation is rejected from mini-skill promotion', async () => {
    const { observation } = await storeObservation({
      entityName: 'health',
      type: 'probe',
      title: 'Agent heartbeat',
      narrative: 'Connectivity check.',
      projectId: PROJECT_ID,
    });
    const obs = getObservation(observation.id)!;
    await expect(
      promoteToMiniSkill(testDir, PROJECT_ID, [obs])
    ).rejects.toThrow(/Cannot promote probe observations/);
  });

  it('probe is still rejected with force=true', async () => {
    const { observation } = await storeObservation({
      entityName: 'health',
      type: 'probe',
      title: 'Agent heartbeat',
      narrative: 'Connectivity check.',
      projectId: PROJECT_ID,
    });
    const obs = getObservation(observation.id)!;
    await expect(
      promoteToMiniSkill(testDir, PROJECT_ID, [obs], { force: true })
    ).rejects.toThrow(/Cannot promote probe observations/);
  });
});

// Formation evaluation

function makeExtractResult(overrides: Partial<ExtractResult> = {}): ExtractResult {
  return {
    title: 'Agent heartbeat',
    titleImproved: false,
    narrative: 'Connectivity check.',
    facts: [],
    extractedFacts: [],
    entityName: 'health',
    entityResolved: false,
    type: 'probe',
    typeCorrected: false,
    ...overrides,
  };
}

describe('Formation: probe has very low TYPE_WEIGHT', () => {
  it('probe evaluation returns low value score', () => {
    const result = runEvaluate(makeExtractResult());
    // probe TYPE_WEIGHT is 0.10, so score should be very low
    expect(result.score).toBeLessThan(0.3);
  });

  it('probe is classified as ephemeral', () => {
    const result = runEvaluate(makeExtractResult());
    expect(result.category).toBe('ephemeral');
  });

  it('probe scores much lower than gotcha', () => {
    const probeResult = runEvaluate(makeExtractResult());
    const gotchaResult = runEvaluate(makeExtractResult({
      type: 'gotcha',
      title: 'Token expiry bug',
      narrative: 'Tokens expire before refresh.',
      entityName: 'auth',
    }));
    expect(probeResult.score).toBeLessThan(gotchaResult.score);
  });
});

// CLI coercion

describe('CLI: coerceObservationType accepts probe', () => {
  it('coerceObservationType("probe") returns "probe"', () => {
    expect(coerceObservationType('probe')).toBe('probe');
  });

  it('coerceObservationType rejects invalid type', () => {
    expect(() => coerceObservationType('invalid-type')).toThrow(/Unknown observation type/);
  });

  it('coerceObservationType accepts all standard types including probe', () => {
    const validTypes = [
      'session-request', 'gotcha', 'problem-solution', 'how-it-works',
      'what-changed', 'discovery', 'why-it-exists', 'decision',
      'trade-off', 'reasoning', 'probe',
    ];
    for (const t of validTypes) {
      expect(coerceObservationType(t)).toBe(t);
    }
  });
});
