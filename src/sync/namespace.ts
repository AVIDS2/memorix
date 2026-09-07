import { createHash } from 'node:crypto';

/** Stable, path-safe namespace for one canonical Git project. */
export function syncNamespace(projectId: string): string {
  return `project-${createHash('sha256').update(projectId).digest('hex').slice(0, 32)}`;
}

export function projectSyncPrefix(projectId: string): string {
  return `p:${encodeURIComponent(projectId)}:`;
}

/** Device IDs are path segments in the filesystem relay and keys elsewhere. */
export function isSafeSyncDeviceId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}
