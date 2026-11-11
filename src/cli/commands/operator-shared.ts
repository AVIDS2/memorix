import { detectProjectWithDiagnostics } from '../../project/detector.js';
import { homeProjectRootError, isHomeDirectory, writeLastProjectRoot } from '../../project/launch-root.js';
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
  const requestedRoot = options?.projectRoot
    ?? invocation.projectRoot
    ?? process.env.MEMORIX_PROJECT_ROOT
    ?? process.cwd();
  if (isHomeDirectory(requestedRoot)) {
    throw new Error(homeProjectRootError(requestedRoot));
  }
  const detection = detectProjectWithDiagnostics(requestedRoot);
  if (!detection.project || isHomeDirectory(detection.project.rootPath)) {
    const detail = detection.failure?.detail ?? homeProjectRootError(requestedRoot);
    throw new Error(detail);
  }

  const project = detection.project;
  const dataDir = await getProjectDataDir(project.id);
  writeLastProjectRoot(project.rootPath);
  return { project, dataDir, invocation };
}

/**
 * Read-only memory commands do not need session bookkeeping or maintenance
 * target registration. Identity resolution remains intact so visibility rules
 * stay identical to the full operator context.
 */
export async function getCliReadContext(options?: CliContextOptions): Promise<CliReadContext> {
  const { project, dataDir, invocation } = await resolveCliProjectContext(options);
  await initObservations(dataDir, {
    embeddingWriteMode: 'deferred',
    projectRoot: project.rootPath,
  });

  if (options?.searchIndex) {
    await prepareSearchIndex({ skipCachedVectors: true });
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
    await prepareSearchIndex({ skipCachedVectors: true });
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

/**
 * Coerce a citty named argument into a trimmed string.
 *
 * Citty accumulates repeated string flags into an array (`--text a --text b`
 * becomes `["a", "b"]`), and Windows shells can split one long quoted
 * argument into several argv elements that re-introduce the flag mid-value
 * (issue #194). Joining the fragments preserves as much of the original text
 * as possible and prevents `TypeError: named?.trim is not a function`.
 */
export function asStringArg(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    const joined = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .join(' ');
    return joined.length > 0 ? joined : undefined;
  }
  return undefined;
}

/**
 * Coerce a repeated scalar flag to its last value (last-wins convention for
 * enums, IDs, and numeric limits). Repeated flags are otherwise accumulated
 * into arrays by citty and would reach `.trim()` as non-strings.
 */
export function lastStringArg(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const strings = value.filter((item): item is string => typeof item === 'string');
    return strings[strings.length - 1];
  }
  return undefined;
}

export function parseCsvList(input?: string | string[] | null): string[] {
  if (!input) return [];
  const source = Array.isArray(input)
    ? input.filter((item): item is string => typeof item === 'string').join(',')
    : input;
  return source
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

export function parsePositiveInt(input: string | string[] | undefined, fallback: number): number {
  const value = lastStringArg(input);
  if (value == null || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`Expected a positive integer, received "${value}".`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${value}".`);
  }
  return parsed;
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

export function coerceObservationType(input?: unknown): ObservationType {
  const normalized = (lastStringArg(input) ?? 'discovery') as ObservationType;
  if (!OBSERVATION_TYPES.includes(normalized)) {
    throw new Error(
      `Unknown observation type "${String(input ?? '')}". Valid types: ${OBSERVATION_TYPES.join(', ')}`,
    );
  }
  return normalized;
}

export function coerceObservationStatus(input?: unknown): ObservationStatus {
  const normalized = (lastStringArg(input) ?? 'resolved') as ObservationStatus;
  if (!OBSERVATION_STATUSES.includes(normalized)) {
    throw new Error(
      `Unknown observation status "${String(input ?? '')}". Valid statuses: ${OBSERVATION_STATUSES.join(', ')}`,
    );
  }
  return normalized;
}

export function coerceRetrievalQuality(input?: unknown): RetrievalQuality {
  const normalized = (lastStringArg(input) ?? 'balanced').trim().toLowerCase() as RetrievalQuality;
  if (!RETRIEVAL_QUALITIES.includes(normalized)) {
    throw new Error('quality must be fast, balanced, or thorough');
  }
  return normalized;
}

export function coerceObservationVisibility(input?: unknown): ObservationVisibility {
  const normalized = (lastStringArg(input) ?? 'project').trim().toLowerCase();
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
