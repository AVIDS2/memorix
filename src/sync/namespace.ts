import { createHash } from 'node:crypto';

/** Sentinel project id for user-global store sync envelopes and local state. */
export const USER_SYNC_SCOPE_ID = '__user__';

/** Default remote namespace for user-global store sync. */
export const USER_SYNC_NAMESPACE = 'user-global';

/** Stable, path-safe namespace for one canonical Git project. */
export function syncNamespace(projectId: string): string {
  return `project-${createHash('sha256').update(projectId).digest('hex').slice(0, 32)}`;
}

/**
 * Remote namespace for `--scope user`. Isolation is the configured remote
 * (fs root, S3 prefix, Postgres database). Override with
 * `MEMORIX_SYNC_USER_NAMESPACE` when several operators share one remote.
 */
export function userSyncNamespace(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.MEMORIX_SYNC_USER_NAMESPACE?.trim();
  if (!override) return USER_SYNC_NAMESPACE;
  if (!isSafeSyncDeviceId(override)) {
    throw new Error('[memorix] MEMORIX_SYNC_USER_NAMESPACE must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}');
  }
  return `user-${override}`;
}

export function projectSyncPrefix(projectId: string): string {
  return `p:${encodeURIComponent(projectId)}:`;
}

/** Device IDs are path segments in the filesystem relay and keys elsewhere. */
export function isSafeSyncDeviceId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}
