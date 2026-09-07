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
import { compareVersion, mergeOne } from './merge.js';
import { eligibleObservations, syncEligibility } from './policy.js';
import type {
  ChangeBatch,
  SyncConflict,
  SyncDecision,
  SyncCursor,
  SyncPendingBatch,
  SyncRemote,
  SyncReport,
  SyncRowState,
} from './types.js';
import { createHash } from 'node:crypto';

/**
 * Everything the engine needs from the local side. The SQLite binding lives in
 * `store-port.ts`; tests supply an in-memory fake.
 */
export interface SyncStorePort {
  projectId(): string;
  namespace(): string;
  /** Stable device id for this replica. */
  deviceId(): string;
  /** Refuse writes when this data directory was copied to another machine. */
  assertCanPublish(): void;
  /** Rotate a cloned installation onto a new device identity. */
  rotateDevice(): string;
  /** Current local cursor for this project/remote namespace. */
  loadCursor(): Promise<SyncCursor>;
  saveCursor(cursor: SyncCursor): Promise<void>;
  /** Current project observations only. */
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
  getById(id: number): Promise<Observation | undefined>;
  recordConflict(conflict: SyncConflict): Promise<void>;
  loadPendingBatches(): Promise<SyncPendingBatch[]>;
  enqueueBatch(pending: SyncPendingBatch): Promise<void>;
  markBatchShipped(sequence: number): Promise<void>;
  /** Next monotonic batch sequence for this device. */
  nextSequence(): Promise<number>;
}

const PULL_PAGE_SIZE = 100;
const MAX_BATCH_BYTES = 750_000;

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
    namespace: remote.namespace,
    projectId: store.projectId(),
    deviceId: opts.deviceId,
    pushed: 0,
    pulledBatches: 0,
    applied: 0,
    skipped: 0,
    tombstoned: 0,
    eligible: 0,
    excluded: 0,
    conflicts: 0,
    pending: 0,
    dryRun: opts.dryRun,
    decisions: [],
  };

  if (remote.namespace !== store.namespace()) {
    throw new Error('[memorix] sync refused: store and remote namespaces do not match');
  }
  await remote.init({ create: !opts.dryRun });
  try {
    // ── Push ──────────────────────────────────────────────────────────
    if (opts.push) {
      const pending = await store.loadPendingBatches();
      report.pending = pending.length;
      if (!opts.dryRun) {
        store.assertCanPublish();
        for (const pendingBatch of pending) {
          await remote.push(pendingBatch.batch);
          await store.saveState(pendingBatch.states);
          await store.markBatchShipped(pendingBatch.batch.sequence);
          report.pushed += pendingBatch.batch.entries.length;
        }
        report.pending = 0;
      }
      const current = await store.loadAll();
      const filtered = eligibleObservations(current, store.projectId());
      report.eligible = filtered.eligible.length;
      report.excluded = filtered.excluded;
      const state = await store.loadState();
      const changes = computeChanges({
        current: filtered.eligible,
        state,
        deviceId: opts.deviceId,
        projectId: store.projectId(),
        excludedObservationIds: new Set(current.filter((observation) => !syncEligibility(observation, store.projectId()).eligible).map((observation) => observation.id)),
      });
      if (changes.length > 0) {
        const chunks = chunkChanges(changes);
        for (const chunk of chunks) {
          const sequence = opts.dryRun ? 0 : await store.nextSequence();
          const batch: ChangeBatch = {
            formatVersion: 3,
            namespace: remote.namespace,
            projectId: store.projectId(),
            deviceId: opts.deviceId,
            sequence,
            producedAt: nowIso(),
            entries: chunk.map((c) => c.entry),
          };
          report.pushed += chunk.length;
          if (!opts.dryRun) {
            const states = chunk.map((c) => ({ ...c.nextState, shippedSeq: sequence }));
            await store.enqueueBatch({ batch, states });
            await remote.push(batch);
            await store.saveState(states);
            await store.markBatchShipped(sequence);
          }
        }
      }
    }

    // ── Pull ──────────────────────────────────────────────────────────
    if (opts.pull) {
      const cursor = await store.loadCursor();
      const state = await store.loadState();
      let pageToken: string | undefined;
      let hasMore = true;
      while (hasMore) {
        const page = await remote.pull(cursor.applied, PULL_PAGE_SIZE, pageToken);
        report.pulledBatches += page.batches.length;
        validateBatches(page.batches, store.projectId(), remote.namespace);

        for (const batch of page.batches) {
          if (batch.deviceId === opts.deviceId) {
            cursor.applied[batch.deviceId] = Math.max(cursor.applied[batch.deviceId] ?? 0, batch.sequence);
            continue;
          }
          for (const entry of batch.entries) {
            const local = state.get(entry.syncKey);
            const incomingHash = entry.row ? contentHash(entry.row) : '';
            if (entry.contentHash !== incomingHash) {
              throw new Error('[memorix] sync batch rejected: content hash mismatch');
            }
            const { decision, action } = mergeOne({ incoming: entry, local, incomingHash });
            recordDecision(report, decision);
            if (local && entry.version.revision === local.revision && entry.version.writer !== local.writer) {
              const currentRow = local.obsId == null ? undefined : await store.getById(local.obsId);
              if (opts.dryRun) report.conflicts++;
              else await recordConcurrentConflict(store, report, local, entry, action.type === 'noop' ? entry.row : currentRow);
            }
            if (opts.dryRun || action.type === 'noop') {
              if (!opts.dryRun && action.type === 'noop' && decision.outcome === 'apply') {
                const next: SyncRowState = {
                  projectId: store.projectId(),
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
              next = { projectId: store.projectId(), syncKey: entry.syncKey, obsId: newId, revision: action.version.revision, writer: action.version.writer, kind: 'upsert', contentHash: action.contentHash, shippedSeq: local?.shippedSeq ?? 0 };
            } else if (action.type === 'update') {
              const row = { ...entry.row!, id: action.obsId };
              await store.applyUpdate(row);
              next = { projectId: store.projectId(), syncKey: entry.syncKey, obsId: action.obsId, revision: action.version.revision, writer: action.version.writer, kind: 'upsert', contentHash: action.contentHash, shippedSeq: local?.shippedSeq ?? 0 };
            } else {
              await store.applyRemove(action.obsId);
              next = { projectId: store.projectId(), syncKey: entry.syncKey, obsId: null, revision: action.version.revision, writer: action.version.writer, kind: 'tombstone', contentHash: '', shippedSeq: local?.shippedSeq ?? 0 };
            }
            state.set(entry.syncKey, next);
            await store.saveState([next]);
          }
          cursor.applied[batch.deviceId] = Math.max(cursor.applied[batch.deviceId] ?? 0, batch.sequence);
        }
        hasMore = page.hasMore;
        pageToken = page.nextPageToken;
        if (!opts.dryRun && page.batches.length > 0) await store.saveCursor(cursor);
        if (page.batches.length === 0 && !page.nextPageToken) hasMore = false;
        if (hasMore && !page.nextPageToken) throw new Error('[memorix] sync remote returned an unpaged continuation');
      }
    }
    return report;
  } finally {
    await remote.close();
  }
}

function validateBatches(batches: ChangeBatch[], projectId: string, namespace: string): void {
  for (const batch of batches) {
    if (batch.formatVersion !== 3 || batch.projectId !== projectId || batch.namespace !== namespace) {
      throw new Error('[memorix] sync batch rejected: wrong format, project, or remote namespace');
    }
    if (!batch.deviceId || !Number.isSafeInteger(batch.sequence) || batch.sequence < 1 || !Array.isArray(batch.entries)) {
      throw new Error('[memorix] sync batch rejected: malformed envelope');
    }
    for (const entry of batch.entries) {
      if (!entry.syncKey || !entry.version || !Number.isSafeInteger(entry.version.revision) || !entry.version.writer) {
        throw new Error('[memorix] sync batch rejected: malformed change entry');
      }
      if (entry.kind === 'upsert' && (!entry.row || !syncEligibility(entry.row, projectId).eligible)) {
        throw new Error('[memorix] sync batch rejected: ineligible observation payload');
      }
    }
  }
}

function chunkChanges<T extends { entry: ChangeBatch['entries'][number] }>(changes: T[]): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentBytes = 2;
  for (const change of changes) {
    const bytes = Buffer.byteLength(JSON.stringify(change.entry), 'utf8') + 1;
    if (bytes + 2 > MAX_BATCH_BYTES) throw new Error('[memorix] one sync event is too large for the relay');
    if (current.length > 0 && currentBytes + bytes > MAX_BATCH_BYTES) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(change);
    currentBytes += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function recordConcurrentConflict(
  store: SyncStorePort,
  report: SyncReport,
  local: SyncRowState,
  incoming: ChangeBatch['entries'][number],
  localRow: Observation | undefined,
): Promise<void> {
  const incomingWins = compareVersion(incoming.version, { revision: local.revision, writer: local.writer }) > 0;
  const loser = incomingWins ? { revision: local.revision, writer: local.writer } : incoming.version;
  const loserRow = incomingWins ? localRow : incoming.row;
  const id = createHash('sha256')
    .update(`${store.projectId()}|${incoming.syncKey}|${local.revision}|${local.writer}|${incoming.version.revision}|${incoming.version.writer}`)
    .digest('hex');
  await store.recordConflict({
    id,
    projectId: store.projectId(),
    syncKey: incoming.syncKey,
    winner: incomingWins ? incoming.version : { revision: local.revision, writer: local.writer },
    loser,
    loserKind: incomingWins ? local.kind : incoming.kind,
    loserRow,
    createdAt: nowIso(),
    reason: 'concurrent versions shared the same logical revision',
  });
  report.conflicts++;
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
