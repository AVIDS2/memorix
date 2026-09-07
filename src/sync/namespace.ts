import { createHash } from 'node:crypto';

/** Stable, path-safe namespace for one canonical Git project. */
export function syncNamespace(projectId: string): string {
  return `project-${createHash('sha256').update(projectId).digest('hex').slice(0, 32)}`;
}

export function projectSyncPrefix(projectId: string): string {
  return `p:${encodeURIComponent(projectId)}:`;
}
