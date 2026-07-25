import type { ObservationReader, ObservationVisibility } from '../types.js';

/** Minimal common shape shared by persisted observations and Orama documents. */
export interface VisibilityRecord {
  projectId: string;
  visibility?: ObservationVisibility | string;
  createdByAgentId?: string;
  sharedWithAgentIds?: string[] | string;
}

/**
 * Pre-control-plane records were intentionally project-shared. Preserve that
 * behavior so an upgrade does not make a user's historical memory disappear.
 */
export function resolveObservationVisibility(record: Pick<VisibilityRecord, 'visibility'>): ObservationVisibility {
  switch (record.visibility) {
    case 'personal':
    case 'team':
    case 'project':
      return record.visibility;
    default:
      return 'project';
  }
}

function sharedAgentIds(record: VisibilityRecord): string[] {
  if (Array.isArray(record.sharedWithAgentIds)) return record.sharedWithAgentIds;
  if (typeof record.sharedWithAgentIds !== 'string' || !record.sharedWithAgentIds) return [];
  try {
    const parsed = JSON.parse(record.sharedWithAgentIds);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The policy is intentionally fail-closed for personal and team scopes. A
 * missing actor never turns a private record into a project-wide result.
 * `undefined` is reserved for trusted internal maintenance, not MCP delivery.
 */
export function canReadObservation(record: VisibilityRecord, reader?: ObservationReader): boolean {
  if (!reader) return true;

  const sameProject = reader.projectId === record.projectId;
  const visibility = resolveObservationVisibility(record);
  // An explicit global search may inspect project-visible facts across projects,
  // but it never gains a team or personal scope without a bound project.
  if (visibility === 'project') return !reader.projectId || sameProject;
  if (!sameProject || !reader.agentId) return false;

  if (visibility === 'team') return reader.isTeamMember === true;
  return record.createdByAgentId === reader.agentId || sharedAgentIds(record).includes(reader.agentId);
}

/**
 * Reading a targeted handoff does not grant the recipient permission to alter
 * it. Project evidence is jointly maintainable; personal records stay owned by
 * their creator; team records require an active team member.
 */
export function canManageObservation(record: VisibilityRecord, reader?: ObservationReader): boolean {
  if (!reader) return true;
  if (!reader.projectId || reader.projectId !== record.projectId) return false;

  switch (resolveObservationVisibility(record)) {
    case 'project':
      return true;
    case 'team':
      return reader.isTeamMember === true;
    case 'personal':
      return Boolean(reader.agentId && record.createdByAgentId === reader.agentId);
  }
}

export function filterReadableObservations<T extends VisibilityRecord>(
  observations: readonly T[],
  reader?: ObservationReader,
): T[] {
  return reader ? observations.filter((observation) => canReadObservation(observation, reader)) : [...observations];
}
