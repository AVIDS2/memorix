import { createHash } from 'node:crypto';

/** Sentinel project id for user-global store sync envelopes and local state. */
export const USER_SYNC_SCOPE_ID = '__user__';

/** Prefix used for explicit user-global remote namespaces. */
export const USER_SYNC_NAMESPACE = 'user-';

/** Stable, path-safe namespace for one canonical Git project. */
export function syncNamespace(projectId: string): string {
  return `project-${createHash('sha256').update(projectId).digest('hex').slice(0, 32)}`;
}

/**
 * Remote namespace for `--scope user`. The operator must choose a stable
 * namespace and reuse it on the same user's devices. Requiring the value is
 * intentional: a fixed default would allow two operators sharing a relay to
 * exchange otherwise project-visible memories.
 */
export function userSyncNamespace(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.MEMORIX_SYNC_USER_NAMESPACE?.trim();
  if (!override) {
    throw new Error('[memorix] MEMORIX_SYNC_USER_NAMESPACE is required for --scope user; use one stable per-user namespace across devices');
  }
  if (!isSafeSyncDeviceId(override)) {
    throw new Error('[memorix] MEMORIX_SYNC_USER_NAMESPACE must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}');
  }
  return `${USER_SYNC_NAMESPACE}${override}`;
}

export function projectSyncPrefix(projectId: string): string {
  return `p:${encodeURIComponent(projectId)}:`;
}

/** Device IDs are path segments in the filesystem relay and keys elsewhere. */
export function isSafeSyncDeviceId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}
