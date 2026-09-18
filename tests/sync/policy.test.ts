import { describe, expect, it } from 'vitest';

import type { Observation } from '../../src/types.js';
import { eligibleObservations, syncEligibility } from '../../src/sync/policy.js';

function obs(partial: Partial<Observation> & { id: number; projectId: string }): Observation {
  return {
    entityName: 'e',
    type: 'decision',
    title: 't',
    narrative: '',
    facts: [],
    filesModified: [],
    concepts: [],
    tokens: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'active',
    visibility: 'project',
    admissionState: 'qualified',
    ...partial,
  } as Observation;
}

describe('sync eligibility', () => {
  it('drops other-project rows in project scope and keeps them in user scope', () => {
    const row = obs({ id: 1, projectId: 'org/other' });
    expect(syncEligibility(row, 'org/one').reason).toBe('other-project');
    expect(syncEligibility(row, '__user__', 'user').eligible).toBe(true);
  });

  it('still drops personal, targeted, and ephemeral rows in user scope', () => {
    expect(syncEligibility(obs({ id: 1, projectId: 'org/one', visibility: 'personal' }), '__user__', 'user').reason)
      .toBe('non-project-visibility');
    expect(syncEligibility(obs({ id: 2, projectId: 'org/one', sharedWithAgentIds: ['agent-1'] }), '__user__', 'user').reason)
      .toBe('agent-targeted');
    expect(syncEligibility(obs({ id: 3, projectId: 'org/one', admissionState: 'candidate' }), '__user__', 'user').reason)
      .toBe('unqualified-observation');
    expect(syncEligibility(obs({ id: 4, projectId: 'org/one', valueCategory: 'ephemeral' }), '__user__', 'user').reason)
      .toBe('ephemeral-value');
  });

  it('counts excluded rows per scope', () => {
    const rows = [
      obs({ id: 1, projectId: 'org/one' }),
      obs({ id: 2, projectId: 'org/two' }),
      obs({ id: 3, projectId: 'org/one', visibility: 'personal' }),
    ];
    expect(eligibleObservations(rows, 'org/one').eligible).toHaveLength(1);
    expect(eligibleObservations(rows, 'org/one').excluded).toBe(2);
    expect(eligibleObservations(rows, '__user__', 'user').eligible).toHaveLength(2);
    expect(eligibleObservations(rows, '__user__', 'user').excluded).toBe(1);
  });
});
