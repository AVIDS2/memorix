import { detectProjectWithDiagnostics } from '../../project/detector.js';
import { getProjectDataDir } from '../../store/persistence.js';
import { initObservations, prepareSearchIndex } from '../../memory/observations.js';
import { initSessionStore } from '../../store/session-store.js';
import { initTeamStore, type TeamStore } from '../../team/team-store.js';
import type {
  ProjectInfo,
  ObservationReader,
  ObservationStatus,
  ObservationType,
  ObservationVisibility,
  RetrievalQuality,
} from '../../types.js';
import { getCliInvocation } from '../invocation.js';
import { loadCliIdentity, resolveCliIdentity, type CliIdentity } from '../identity.js';

export interface CliProjectContext {
  project: ProjectInfo;
  dataDir: string;
  teamStore: TeamStore;
  reader: ObservationReader;
  identity: CliIdentity | null;
  identityWarning?: string;
}

export interface CliReadContext {
  project: ProjectInfo;
  dataDir: string;
  reader: ObservationReader;
  identity: CliIdentity | null;
  identityWarning?: string;
}

interface CliContextOptions {
  searchIndex?: boolean;
  projectRoot?: string;
}

async function resolveCliProjectContext(options?: CliContextOptions): Promise<{
  project: ProjectInfo;
  dataDir: string;
  invocation: ReturnType<typeof getCliInvocation>;
}> {
  const invocation = getCliInvocation();
  const detection = detectProjectWithDiagnostics(
    options?.projectRoot
      ?? invocation.projectRoot
      ?? process.env.MEMORIX_PROJECT_ROOT
      ?? process.cwd(),
  );
  if (!detection.project) {
    const detail = detection.failure?.detail ?? 'No git repository found in the current directory.';
    throw new Error(detail);
  }

  const project = detection.project;
  const dataDir = await getProjectDataDir(project.id);
  return { project, dataDir, invocation };
}

/**
 * Read-only memory commands do not need session bookkeeping or maintenance
 * target registration. Identity resolution remains intact so visibility rules
 * stay identical to the full operator context.
 */
export async function getCliReadContext(options?: CliContextOptions): Promise<CliReadContext> {
  const { project, dataDir, invocation } = await resolveCliProjectContext(options);
  await initObservations(dataDir);

  if (options?.searchIndex) {
    await prepareSearchIndex();
  }

  const storedIdentity = await loadCliIdentity(dataDir, project.id);
  if (!invocation.actorId && !storedIdentity) {
    return {
      project,
      dataDir,
      reader: { projectId: project.id },
      identity: null,
    };
  }

  const teamStore = await initTeamStore(dataDir);
  const identity = await resolveCliIdentity({
    project,
    dataDir,
    teamStore,
    explicitActorId: invocation.actorId,
  });

  return {
    project,
    dataDir,
    reader: identity.reader,
    identity: identity.identity,
    ...(identity.warning ? { identityWarning: identity.warning } : {}),
  };
}

export async function getCliProjectContext(options?: CliContextOptions): Promise<CliProjectContext> {
  const { project, dataDir, invocation } = await resolveCliProjectContext(options);
  try {
    const { MaintenanceTargetStore } = await import('../../runtime/maintenance-targets.js');
    new MaintenanceTargetStore(dataDir).register({
      projectId: project.id,
      projectRoot: project.rootPath,
      dataDir,
    });
  } catch {
    // CLI reads remain available even if optional background maintenance metadata fails.
  }
  await initObservations(dataDir, {
    embeddingWriteMode: 'deferred',
    projectRoot: project.rootPath,
  });
  await initSessionStore(dataDir);
  const teamStore = await initTeamStore(dataDir);

  if (options?.searchIndex) {
    await prepareSearchIndex();
  }

  const identity = await resolveCliIdentity({
    project,
    dataDir,
    teamStore,
    explicitActorId: invocation.actorId,
  });

  return {
    project,
    dataDir,
    teamStore,
    reader: identity.reader,
    identity: identity.identity,
    ...(identity.warning ? { identityWarning: identity.warning } : {}),
  };
}

export function emitResult<T>(data: T, text: string, asJson?: boolean): void {
  console.log(asJson ? JSON.stringify(data, null, 2) : text);
}

export function emitError(message: string, asJson?: boolean): void {
  console.error(asJson ? JSON.stringify({ error: message }, null, 2) : `Error: ${message}`);
  process.exitCode = 1;
}

export function parseCsvList(input?: string | null): string[] {
  if (!input) return [];
  return input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseOptionalJsonObject(input?: string, field = 'value'): Record<string, unknown> | undefined {
  if (!input) return undefined;
  try {
    const parsed = JSON.parse(input);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${field} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Invalid ${field} JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function shortId(id?: string | null): string {
  return id ? `${id.slice(0, 8)}…` : '-';
}

export function parsePositiveInt(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const OBSERVATION_TYPES: ObservationType[] = [
  'session-request',
  'gotcha',
  'problem-solution',
  'how-it-works',
  'what-changed',
  'discovery',
  'why-it-exists',
  'decision',
  'trade-off',
  'reasoning',
  'probe',
];

const OBSERVATION_STATUSES: ObservationStatus[] = ['active', 'resolved', 'archived'];
const RETRIEVAL_QUALITIES: RetrievalQuality[] = ['fast', 'balanced', 'thorough'];

export function coerceObservationType(input?: string): ObservationType {
  const normalized = (input ?? 'discovery') as ObservationType;
  if (!OBSERVATION_TYPES.includes(normalized)) {
    throw new Error(
      `Unknown observation type "${input}". Valid types: ${OBSERVATION_TYPES.join(', ')}`,
    );
  }
  return normalized;
}

export function coerceObservationStatus(input?: string): ObservationStatus {
  const normalized = (input ?? 'resolved') as ObservationStatus;
  if (!OBSERVATION_STATUSES.includes(normalized)) {
    throw new Error(
      `Unknown observation status "${input}". Valid statuses: ${OBSERVATION_STATUSES.join(', ')}`,
    );
  }
  return normalized;
}

export function coerceRetrievalQuality(input?: string): RetrievalQuality {
  const normalized = (input ?? 'balanced').trim().toLowerCase() as RetrievalQuality;
  if (!RETRIEVAL_QUALITIES.includes(normalized)) {
    throw new Error('quality must be fast, balanced, or thorough');
  }
  return normalized;
}

export function coerceObservationVisibility(input?: string): ObservationVisibility {
  const normalized = (input ?? 'project').trim().toLowerCase();
  if (normalized === 'personal' || normalized === 'project' || normalized === 'team') {
    return normalized;
  }
  throw new Error('visibility must be personal, project, or team');
}

/**
 * Project scope is deliberately the default. Private and team-scoped records
 * require an identity selected by the operator, so a plain shell does not
 * accidentally gain access to another agent's work.
 */
export function resolveCliWriteScope(
  context: Pick<CliProjectContext, 'identity' | 'reader'>,
  visibilityInput?: string,
): {
  visibility: ObservationVisibility;
  createdByAgentId?: string;
  visibilityReader: ObservationReader;
} {
  const visibility = coerceObservationVisibility(visibilityInput);
  if (visibility !== 'project' && !context.identity) {
    throw new Error(
      `visibility=${visibility} requires an active CLI identity. Run "memorix identity join --agent-type <agent>" or "memorix identity use --agent-id <id>" first.`,
    );
  }
  if (visibility === 'team' && context.reader.isTeamMember !== true) {
    throw new Error('team visibility requires an active coordination identity for this project.');
  }

  return {
    visibility,
    ...(context.identity ? { createdByAgentId: context.identity.agentId } : {}),
    visibilityReader: context.reader,
  };
}

/**
 * Coordination commands can use the current CLI identity implicitly, while
 * retaining explicit IDs for scripts and backwards-compatible invocations.
 */
export function resolveCliActorId(
  explicitValue: unknown,
  identity: CliIdentity | null,
  field = 'agentId',
): string | undefined {
  const explicit = typeof explicitValue === 'string' ? explicitValue.trim() : '';
  if (identity && explicit && explicit !== identity.agentId) {
    throw new Error(`${field} does not match the active CLI identity. Use "memorix identity clear" before acting as a different agent.`);
  }
  return explicit || identity?.agentId;
}
