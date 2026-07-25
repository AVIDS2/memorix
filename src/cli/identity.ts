import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ObservationReader, ProjectInfo } from '../types.js';
import type { TeamStore } from '../team/team-store.js';

export interface CliIdentity {
  agentId: string;
  projectId: string;
  activatedAt: string;
}

export interface CliIdentityResolution {
  identity: CliIdentity | null;
  reader: ObservationReader;
  warning?: string;
}

function identityPath(dataDir: string): string {
  return path.join(dataDir, 'cli-identity.json');
}

function isCliIdentity(value: unknown): value is CliIdentity {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CliIdentity>;
  return typeof candidate.agentId === 'string'
    && typeof candidate.projectId === 'string'
    && typeof candidate.activatedAt === 'string';
}

export async function loadCliIdentity(dataDir: string, projectId: string): Promise<CliIdentity | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(identityPath(dataDir), 'utf8'));
    return isCliIdentity(parsed) && parsed.projectId === projectId ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveCliIdentity(dataDir: string, identity: CliIdentity): Promise<void> {
  await fs.writeFile(identityPath(dataDir), `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
}

export async function clearCliIdentity(dataDir: string): Promise<void> {
  await fs.rm(identityPath(dataDir), { force: true });
}

/**
 * An unbound terminal remains project-scoped. Private and team access becomes
 * available only after the operator explicitly chooses an active team identity.
 */
export async function resolveCliIdentity(options: {
  project: ProjectInfo;
  dataDir: string;
  teamStore: TeamStore;
  explicitActorId?: string;
}): Promise<CliIdentityResolution> {
  const stored = await loadCliIdentity(options.dataDir, options.project.id);
  const requestedAgentId = options.explicitActorId ?? stored?.agentId;
  const projectReader: ObservationReader = { projectId: options.project.id };
  if (!requestedAgentId) return { identity: null, reader: projectReader };

  const agent = options.teamStore.getAgent(requestedAgentId);
  const activeForProject = agent
    && agent.project_id === options.project.id
    && agent.status === 'active';
  if (!activeForProject) {
    if (options.explicitActorId) {
      throw new Error(`CLI actor "${requestedAgentId}" is not an active member of this project.`);
    }
    return {
      identity: null,
      reader: projectReader,
      warning: `Saved CLI identity "${requestedAgentId}" is no longer active for this project.`,
    };
  }

  return {
    identity: stored ?? {
      agentId: agent.agent_id,
      projectId: options.project.id,
      activatedAt: new Date().toISOString(),
    },
    reader: {
      projectId: options.project.id,
      agentId: agent.agent_id,
      isTeamMember: true,
    },
  };
}
