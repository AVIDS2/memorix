import { describe, expect, it } from 'vitest';
import {
  canManageObservation,
  canReadObservation,
  filterReadableObservations,
  resolveObservationVisibility,
} from '../../src/memory/visibility.js';

describe('observation visibility policy', () => {
  const owner = 'agent-owner';
  const recipient = 'agent-recipient';
  const other = 'agent-other';
  const projectReader = { projectId: 'project-a' };
  const ownerReader = { projectId: 'project-a', agentId: owner, isTeamMember: true };
  const recipientReader = { projectId: 'project-a', agentId: recipient, isTeamMember: true };
  const otherReader = { projectId: 'project-a', agentId: other, isTeamMember: true };

  it('keeps legacy records project-visible after upgrade', () => {
    const legacy = { projectId: 'project-a' };

    expect(resolveObservationVisibility(legacy)).toBe('project');
    expect(canReadObservation(legacy, projectReader)).toBe(true);
  });

  it('fails closed for personal records without an owner identity', () => {
    const personal = { projectId: 'project-a', visibility: 'personal' as const, createdByAgentId: owner };

    expect(canReadObservation(personal, projectReader)).toBe(false);
    expect(canReadObservation(personal, ownerReader)).toBe(true);
    expect(canReadObservation(personal, otherReader)).toBe(false);
  });

  it('allows an explicit targeted-handoff recipient to read but not alter a personal record', () => {
    const handoff = {
      projectId: 'project-a',
      visibility: 'personal' as const,
      createdByAgentId: owner,
      sharedWithAgentIds: [recipient],
    };

    expect(canReadObservation(handoff, ownerReader)).toBe(true);
    expect(canReadObservation(handoff, recipientReader)).toBe(true);
    expect(canReadObservation(handoff, otherReader)).toBe(false);
    expect(canManageObservation(handoff, ownerReader)).toBe(true);
    expect(canManageObservation(handoff, recipientReader)).toBe(false);
  });

  it('requires active same-project team membership for team records', () => {
    const teamRecord = { projectId: 'project-a', visibility: 'team' as const, createdByAgentId: owner };

    expect(canReadObservation(teamRecord, recipientReader)).toBe(true);
    expect(canReadObservation(teamRecord, { projectId: 'project-a', agentId: recipient, isTeamMember: false })).toBe(false);
    expect(canReadObservation(teamRecord, { projectId: 'project-b', agentId: recipient, isTeamMember: true })).toBe(false);
  });

  it('keeps global search limited to project-visible records', () => {
    const records = [
      { projectId: 'project-a', visibility: 'project' as const, title: 'project fact' },
      { projectId: 'project-a', visibility: 'team' as const, title: 'team handoff' },
      { projectId: 'project-a', visibility: 'personal' as const, createdByAgentId: owner, title: 'private note' },
    ];

    expect(filterReadableObservations(records, {}).map((record) => record.title)).toEqual(['project fact']);
  });
});
