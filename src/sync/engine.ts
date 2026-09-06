/**
 * Sync engine — orchestrates push and pull against any `SyncRemote`.
 *
 * Local-first and off the hot path: the engine reads the local store, ships a
 * change journal, pulls remote batches, and applies them through the pure merge
 * policy. All identity/versioning lives in `sync_row_state`; the engine only
 * moves data between that state, the observation store, and the remote.
 */
import type { Observation } from '../types.js';
import { computeChanges, contentHash, nowIso } from './journal.js';
import { mergeOne } from './merge.js';
import type {
  ChangeBatch,
  SyncDecision,
  SyncRemote,
  SyncReport,
  SyncRowState,
} from './types.js';

/**
 * Everything the engine needs from the local side. The SQLite binding lives in
 * `store-port.ts`; tests supply an in-memory fake.
 */
export interface SyncStorePort {
  /** Stable device id for this replica. */
  deviceId(): string;
  /** All live observations. */
  loadAll(): Promise<Observation[]>;
  /** Recorded sync state, keyed by syncKey. */
  loadState(): Promise<Map<string, SyncRowState>>;
  /** Upsert sync-state rows. */
  saveState(rows: SyncRowState[]): Promise<void>;
  /** Reserve and return a fresh local observation id (for imports). */
  allocateId(): Promise<number>;
  /** Insert an imported observation (id already assigned). */
  applyInsert(row: Observation): Promise<void>;
  /** Update an existing observation in place. */
  applyUpdate(row: Observation): Promise<void>;
  /** Remove an observation by local id. */
  applyRemove(id: number): Promise<void>;
  /** Next monotonic batch sequence for this device. */
  nextSequence(): Promise<number>;
}

export interface RunOptions {
  deviceId: string;
  dryRun: boolean;
  /** When false, only pull (no local changes shipped). */
  push: boolean;
  /** When false, only push (no remote changes applied). */
  pull: boolean;
}

export async function runSync(
  store: SyncStorePort,
  remote: SyncRemote,
  opts: RunOptions,
): Promise<SyncReport> {
  const report: SyncReport = {
    remote: remote.kind,
    deviceId: opts.deviceId,
    pushed: 0,
    pulledBatches: 0,
    applied: 0,
    skipped: 0,
    tombstoned: 0,
    dryRun: opts.dryRun,
    decisions: [],
  };

  await remote.init();

  // ── Push ──────────────────────────────────────────────────────────
  if (opts.push) {
    const current = await store.loadAll();
    const state = await store.loadState();
    const changes = computeChanges({ current, state, deviceId: opts.deviceId });
    if (changes.length > 0) {
      const sequence = await store.nextSequence();
      const batch: ChangeBatch = {
        formatVersion: 2,
        deviceId: opts.deviceId,
        sequence,
        producedAt: nowIso(),
        entries: changes.map((c) => c.entry),
      };
      report.pushed = changes.length;
      if (!opts.dryRun) {
        await remote.push(batch);
        await store.saveState(changes.map((c) => ({ ...c.nextState, shippedSeq: sequence })));
      }
    }
  }

  // ── Pull ──────────────────────────────────────────────────────────
  if (opts.pull) {
    const cursor = await remote.getCursor(opts.deviceId);
    const batches = await remote.pull(cursor.applied);
    report.pulledBatches = batches.length;

    // Re-read state once; keep it current across the batch stream so multiple
    // batches touching one key merge against the latest decision.
    const state = await store.loadState();

    for (const batch of batches) {
      if (batch.deviceId === opts.deviceId) {
        cursor.applied[batch.deviceId] = Math.max(cursor.applied[batch.deviceId] ?? 0, batch.sequence);
        continue; // never re-apply our own writes
      }
      for (const entry of batch.entries) {
        const local = state.get(entry.syncKey);
        const incomingHash = entry.row ? contentHash(entry.row) : '';
        const { decision, action } = mergeOne({ incoming: entry, local, incomingHash });
        recordDecision(report, decision);
        if (opts.dryRun || action.type === 'noop') {
          if (!opts.dryRun && action.type === 'noop' && decision.outcome === 'apply') {
            // Newer tombstone with no live local row: still record the delete
            // so a later stale upsert cannot resurrect it.
            const next: SyncRowState = {
              syncKey: entry.syncKey,
              obsId: null,
              revision: entry.version.revision,
              writer: entry.version.writer,
              kind: 'tombstone',
              contentHash: '',
              shippedSeq: local?.shippedSeq ?? 0,
            };
            state.set(entry.syncKey, next);
            await store.saveState([next]);
          }
          continue;
        }

        let next: SyncRowState;
        if (action.type === 'insert') {
          const newId = await store.allocateId();
          const row = { ...entry.row!, id: newId };
          await store.applyInsert(row);
          next = { syncKey: entry.syncKey, obsId: newId, revision: action.version.revision, writer: action.version.writer, kind: 'upsert', contentHash: action.contentHash, shippedSeq: local?.shippedSeq ?? 0 };
        } else if (action.type === 'update') {
          const row = { ...entry.row!, id: action.obsId };
          await store.applyUpdate(row);
          next = { syncKey: entry.syncKey, obsId: action.obsId, revision: action.version.revision, writer: action.version.writer, kind: 'upsert', contentHash: action.contentHash, shippedSeq: local?.shippedSeq ?? 0 };
        } else {
          await store.applyRemove(action.obsId);
          next = { syncKey: entry.syncKey, obsId: null, revision: action.version.revision, writer: action.version.writer, kind: 'tombstone', contentHash: '', shippedSeq: local?.shippedSeq ?? 0 };
        }
        state.set(entry.syncKey, next);
        await store.saveState([next]);
      }
      cursor.applied[batch.deviceId] = Math.max(cursor.applied[batch.deviceId] ?? 0, batch.sequence);
    }

    if (!opts.dryRun && batches.length > 0) {
      await remote.setCursor(opts.deviceId, cursor);
    }
  }

  await remote.close();
  return report;
}

function recordDecision(report: SyncReport, decision: SyncDecision): void {
  report.decisions.push(decision);
  if (decision.outcome === 'apply') {
    if (decision.kind === 'tombstone') report.tombstoned++;
    else report.applied++;
  } else {
    report.skipped++;
  }
}
