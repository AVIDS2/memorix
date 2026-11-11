import { describe, expect, it } from 'vitest';
import { auditMemoryQuality } from '../../src/memory/quality-audit.js';
import type { Observation } from '../../src/types.js';

function obs(overrides: Partial<Observation>): Observation {
  return {
    id: 1,
    entityName: 'core',
    type: 'discovery',
    title: 'Default memory',
    narrative: 'A useful memory with enough supporting detail.',
    facts: ['Useful fact'],
    filesModified: ['src/core.ts'],
    concepts: ['core'],
    tokens: 50,
    createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    projectId: 'AVIDS2/memorix',
    status: 'active',
    source: 'manual',
    sourceDetail: 'explicit',
    valueCategory: 'contextual',
    ...overrides,
  };
}

describe('auditMemoryQuality', () => {
  it('summarizes memory quality risk without mutating observations', () => {
    const observations = [
      obs({
        id: 1,
        entityName: 'auth',
        title: 'Use JWT refresh tokens',
        narrative: 'We decided to use JWT refresh tokens for auth.',
        type: 'decision',
        valueCategory: 'core',
      }),
      obs({
        id: 2,
        entityName: 'auth',
        title: 'Use JWT refresh tokens',
        narrative: 'We decided to use JWT refresh tokens for auth.',
        type: 'decision',
      }),
      obs({
        id: 3,
        entityName: 'quick-note',
        title: 'Activity',
        narrative: 'User said hello.',
        facts: [],
        filesModified: [],
        concepts: [],
        source: 'agent',
        sourceDetail: 'hook',
        valueCategory: 'ephemeral',
      }),
      obs({
        id: 4,
        entityName: 'isolated-module',
        title: 'Lonely module detail',
        narrative: 'One-off detail with no cross references.',
        facts: [],
        filesModified: [],
        concepts: [],
      }),
      obs({
        id: 5,
        entityName: 'old-session',
        title: 'Old session note',
        narrative: 'Old low-value session note.',
        type: 'session-request',
        facts: [],
        filesModified: [],
        concepts: [],
        createdAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
      }),
      obs({
        id: 6,
        entityName: 'archived',
        title: 'Archived note',
        narrative: 'Not active and should not count as active.',
        status: 'archived',
      }),
    ];

    const report = auditMemoryQuality(observations, {
      projectId: 'AVIDS2/memorix',
      referenceTime: new Date('2026-06-17T00:00:00.000Z'),
    });

    expect(report.summary.total).toBe(6);
    expect(report.summary.active).toBe(5);
    expect(report.summary.core).toBe(1);
    expect(report.summary.ephemeral).toBe(1);
    expect(report.issues.duplicateClusters).toHaveLength(1);
    expect(report.issues.duplicateClusters[0].ids).toEqual([1, 2]);
    expect(report.issues.lowEvidence.map((entry) => entry.id)).toEqual(expect.arrayContaining([3, 4, 5]));
    expect(report.issues.hookNoise.map((entry) => entry.id)).toContain(3);
    expect(report.issues.orphans.map((entry) => entry.id)).toEqual(expect.arrayContaining([3, 4, 5]));
    expect(report.issues.retentionCandidates.map((entry) => entry.id)).toContain(5);
    expect(report.recommendations).toContain('Review 1 duplicate cluster(s) with `memorix memory consolidate --action preview`.');
    expect(observations[2].status).toBe('active');
  });

  it('keeps project filtering explicit', () => {
    const report = auditMemoryQuality([
      obs({ id: 1, projectId: 'AVIDS2/memorix' }),
      obs({ id: 2, projectId: 'other/project' }),
    ], {
      projectId: 'AVIDS2/memorix',
      referenceTime: new Date('2026-06-17T00:00:00.000Z'),
    });

    expect(report.summary.total).toBe(1);
    expect(report.projectId).toBe('AVIDS2/memorix');
  });
});
