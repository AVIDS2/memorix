/**
 * Change journal — derives the set of local changes to ship without diffing
 * the whole database, and defines the stable cross-device row identity.
 *
 * `sync_row_state` maps `syncKey -> SyncRowState` (version + content hash +
 * local id). A row is "dirty" when its current content hash differs from the
 * recorded one; a key present in state but absent from `observations` is a
 * tombstone. These tables are additive — they never touch the `observations`
 * schema — so enabling sync needs no migration of existing data.
 */
import { createHash } from 'node:crypto';

import type { Observation } from '../types.js';
import { nextVersion } from './merge.js';
import type { ChangeEntry, SyncRowState } from './types.js';

export const CREATE_SYNC_TABLES = [
  `CREATE TABLE IF NOT EXISTS sync_row_state (
     projectId   TEXT NOT NULL,
     syncKey     TEXT NOT NULL,
     obsId       INTEGER,
     revision    INTEGER NOT NULL,
     writer      TEXT NOT NULL,
     kind        TEXT NOT NULL,
     contentHash TEXT NOT NULL,
     shippedSeq  INTEGER NOT NULL,
     PRIMARY KEY (projectId, syncKey)
   );`,
  `CREATE TABLE IF NOT EXISTS sync_meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS sync_conflicts (
     id          TEXT PRIMARY KEY,
     projectId   TEXT NOT NULL,
     syncKey     TEXT NOT NULL,
     winnerJson  TEXT NOT NULL,
     loserJson   TEXT NOT NULL,
     createdAt   TEXT NOT NULL,
     reason      TEXT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS sync_outbox (
     projectId   TEXT NOT NULL,
     namespace   TEXT NOT NULL,
     deviceId    TEXT NOT NULL,
     sequence    INTEGER NOT NULL,
     batchJson   TEXT NOT NULL,
     statesJson  TEXT NOT NULL,
     createdAt   TEXT NOT NULL,
     PRIMARY KEY (projectId, namespace, deviceId, sequence)
   );`,
].join('\n');

/** ISO timestamp helper (single source of "now" for the engine). */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Stable cross-device identity for a row.
 *   - Topic-keyed observations share `t:<projectId>:<topicKey>` on every
 *     machine, so an upsert to the same topic converges instead of forking.
 *   - Unkeyed observations get `u:<originDevice>:<originId>`, minted once at
 *     first ship and thereafter carried in `sync_row_state`. Two devices
 *     inserting unrelated rows can never collide, because the origin device id
 *     is part of the key.
 */
export function deriveSyncKey(obs: Observation, originDevice: string): string {
  const project = encodeURIComponent(obs.projectId);
  if (obs.topicKey) return `p:${project}:t:${encodeURIComponent(obs.topicKey)}`;
  return `p:${project}:u:${encodeURIComponent(originDevice)}:${obs.id}`;
}

/**
 * Content fingerprint of the row body. Excludes replica-local fields (`id`,
 * `writeGeneration`) so the same logical content hashes identically on every
 * machine and does not spuriously mark a row dirty after import.
 */
export function contentHash(obs: Observation): string {
  const { id: _id, writeGeneration: _wg, ...rest } = obs as Observation & { writeGeneration?: number };
  const stable = stableJson(rest);
  return createHash('sha256').update(stable).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export interface ComputeInput {
  /** All live observations currently in the local store. */
  current: Observation[];
  /** Recorded sync state, keyed by syncKey. */
  state: Map<string, SyncRowState>;
  /** This device's stable id (becomes the `writer` of new local versions). */
  deviceId: string;
  projectId: string;
  /** Local rows that remain present but are intentionally excluded from sync. */
  excludedObservationIds?: ReadonlySet<number>;
}

/** A change plus the row-state it should persist once the batch is shipped. */
export interface ComputedChange {
  entry: ChangeEntry;
  nextState: SyncRowState;
}

/**
 * Compute the local changes to ship: new/modified rows as upserts, and rows
 * that vanished from `observations` (but are still live in state) as
 * tombstones. Version numbers advance per-row from the recorded revision.
 */
export function computeChanges(input: ComputeInput): ComputedChange[] {
  const { current, state, deviceId, projectId, excludedObservationIds } = input;
  const at = nowIso();
  const changes: ComputedChange[] = [];
  const seenKeys = new Set<string>();

  for (const obs of current) {
    // Reuse the recorded key for this row if one exists (its origin device may
    // differ from us); otherwise derive a fresh one.
    const priorEntry = findStateByObsId(state, obs.id);
    const syncKey = priorEntry?.syncKey ?? deriveSyncKey(obs, deviceId);
    seenKeys.add(syncKey);

    const hash = contentHash(obs);
    const prior = state.get(syncKey);
    if (prior && prior.kind === 'upsert' && prior.obsId === obs.id && prior.contentHash === hash) {
      continue; // unchanged since last ship
    }
    const version = nextVersion(prior, deviceId, at);
    changes.push({
      entry: { syncKey, kind: 'upsert', version, contentHash: hash, row: obs },
      nextState: { projectId, syncKey, obsId: obs.id, revision: version.revision, writer: deviceId, kind: 'upsert', contentHash: hash, shippedSeq: 0 },
    });
  }

  // Tombstones: recorded-live keys no longer present locally.
  for (const prior of state.values()) {
    if (prior.kind === 'tombstone') continue;
    if (seenKeys.has(prior.syncKey)) continue;
    if (prior.obsId != null && excludedObservationIds?.has(prior.obsId)) continue;
    const version = nextVersion(prior, deviceId, at);
    changes.push({
      entry: { syncKey: prior.syncKey, kind: 'tombstone', version, contentHash: '' },
      nextState: { projectId, syncKey: prior.syncKey, obsId: null, revision: version.revision, writer: deviceId, kind: 'tombstone', contentHash: '', shippedSeq: 0 },
    });
  }

  return changes;
}

function findStateByObsId(state: Map<string, SyncRowState>, obsId: number): SyncRowState | undefined {
  for (const s of state.values()) {
    if (s.kind === 'upsert' && s.obsId === obsId) return s;
  }
  return undefined;
}
