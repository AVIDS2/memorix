/**
 * Resolves a `SyncRemote` from configuration. Provider choice is data, not
 * code: the caller picks a provider name and the matching adapter is
 * lazy-imported so unused providers never load their optional SDKs.
 *
 * Configuration is env-driven and opt-in. Sync is OFF unless
 * `MEMORIX_SYNC_PROVIDER` is set (or an explicit provider is passed).
 */

import type { SyncRemote } from './types.js';

export type SyncProvider = 'fs' | 's3' | 'postgres';

export interface SyncConfig {
  enabled: boolean;
  provider?: SyncProvider;
}

export function resolveSyncConfig(env: NodeJS.ProcessEnv = process.env): SyncConfig {
  const provider = env.MEMORIX_SYNC_PROVIDER as SyncProvider | undefined;
  if (!provider) return { enabled: false };
  if (provider !== 'fs' && provider !== 's3' && provider !== 'postgres') {
    throw new Error(`[memorix] unknown MEMORIX_SYNC_PROVIDER "${provider}" (expected fs|s3|postgres)`);
  }
  return { enabled: true, provider };
}

export async function createRemote(
  provider: SyncProvider,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SyncRemote> {
  if (provider === 'fs') {
    const root = env.MEMORIX_SYNC_FS_ROOT;
    if (!root) throw new Error('[memorix] fs sync requires MEMORIX_SYNC_FS_ROOT');
    const { FsRemote } = await import('./adapters/fs.js');
    return new FsRemote({ root });
  }
  if (provider === 's3') {
    const { createS3ObjectStore, ObjectStoreRemote } = await import('./adapters/object-store.js');
    return new ObjectStoreRemote(await createS3ObjectStore(env));
  }
  const { createPgSqlClient, PostgresSyncRemote } = await import('./adapters/postgres.js');
  return new PostgresSyncRemote(await createPgSqlClient(env));
}
