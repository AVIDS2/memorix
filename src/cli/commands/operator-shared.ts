import { detectProjectWithDiagnostics } from '../../project/detector.js';
import { getProjectDataDir } from '../../store/persistence.js';
import { initObservations, prepareSearchIndex } from '../../memory/observations.js';
import { initSessionStore } from '../../store/session-store.js';
import { initTeamStore, type TeamStore } from '../../team/team-store.js';
import type { ProjectInfo, ObservationType, ObservationStatus } from '../../types.js';

export interface CliProjectContext {
  project: ProjectInfo;
  dataDir: string;
  teamStore: TeamStore;
}

export async function getCliProjectContext(options?: { searchIndex?: boolean }): Promise<CliProjectContext> {
  const detection = detectProjectWithDiagnostics(process.cwd());
  if (!detection.project) {
    const detail = detection.failure?.detail ?? 'No git repository found in the current directory.';
    throw new Error(detail);
  }

  const project = detection.project;
  const dataDir = await getProjectDataDir(project.id);
  await initObservations(dataDir);
  await initSessionStore(dataDir);
  const teamStore = await initTeamStore(dataDir);

  if (options?.searchIndex) {
    await prepareSearchIndex();
  }

  return { project, dataDir, teamStore };
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
];

const OBSERVATION_STATUSES: ObservationStatus[] = ['active', 'resolved', 'archived'];

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
