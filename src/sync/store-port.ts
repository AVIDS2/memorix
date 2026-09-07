/**
 * Binds the sync engine's `SyncStorePort` to the real Memorix store: the
 * canonical `ObservationStore` for rows, plus the additive `sync_row_state` /
 * `sync_meta` tables (created here, never altering `observations`).
 *
 * This is the only place the engine touches persistence in production.
 */
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Observation } from '../types.js';
import type { ObservationStore } from '../store/obs-store.js';
import { getDatabase } from '../store/sqlite-db.js';
import { CREATE_SYNC_TABLES } from './journal.js';
import { syncNamespace } from './namespace.js';
import type { SyncStorePort } from './engine.js';
import type { SyncConflict, SyncCursor, SyncPendingBatch, SyncRowState } from './types.js';

const SEQ_KEY = 'local_sequence';
const DEVICE_KEY = 'device_id';
const FINGERPRINT_KEY = 'device_fingerprint';
const LEGACY_PROJECT_ID = '';

export interface SqliteSyncStore extends SyncStorePort {
  /** Stable device id for this store (generated once, persisted in sync_meta). */
  deviceId(): string;
}

export function createSqliteSyncStore(dataDir: string, store: ObservationStore, projectId: string): SqliteSyncStore {
  const db = getDatabase(dataDir);
  ensureSyncSchema(db, projectId);
  const getMeta = db.prepare('SELECT value FROM sync_meta WHERE key = ?');
  const setMeta = db.prepare('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)');
  const selState = db.prepare('SELECT projectId, syncKey, obsId, revision, writer, kind, contentHash, shippedSeq FROM sync_row_state WHERE projectId = ?');
  const upState = db.prepare(
    `INSERT INTO sync_row_state (projectId, syncKey, obsId, revision, writer, kind, contentHash, shippedSeq)
     VALUES (@projectId, @syncKey, @obsId, @revision, @writer, @kind, @contentHash, @shippedSeq)
     ON CONFLICT(projectId, syncKey) DO UPDATE SET
       obsId = excluded.obsId,
       revision = excluded.revision,
       writer = excluded.writer,
       kind = excluded.kind,
       contentHash = excluded.contentHash,
       shippedSeq = excluded.shippedSeq`,
  );
  const insertConflict = db.prepare(
    `INSERT OR IGNORE INTO sync_conflicts (id, projectId, syncKey, winnerJson, loserJson, createdAt, reason)
     VALUES (@id, @projectId, @syncKey, @winnerJson, @loserJson, @createdAt, @reason)`,
  );
  const selPending = db.prepare(
    `SELECT batchJson, statesJson FROM sync_outbox
     WHERE projectId = ? AND namespace = ? AND deviceId = ? ORDER BY sequence ASC`,
  );
  const insertPending = db.prepare(
    `INSERT OR IGNORE INTO sync_outbox
     (projectId, namespace, deviceId, sequence, batchJson, statesJson, createdAt)
     VALUES (@projectId, @namespace, @deviceId, @sequence, @batchJson, @statesJson, @createdAt)`,
  );
  const deletePending = db.prepare(
    `DELETE FROM sync_outbox WHERE projectId = ? AND namespace = ? AND deviceId = ? AND sequence = ?`,
  );
  const pendingForDevice = db.prepare(
    `SELECT projectId, namespace, sequence, batchJson
     FROM sync_outbox WHERE deviceId = ? ORDER BY projectId, namespace, sequence`,
  );
  const rewritePendingDevice = db.prepare(
    `UPDATE sync_outbox
        SET deviceId = ?, batchJson = ?
      WHERE projectId = ? AND namespace = ? AND deviceId = ? AND sequence = ?`,
  );

  const namespace = syncNamespace(projectId);
  const deviceFingerprint = process.env.MEMORIX_SYNC_DEVICE_FINGERPRINT?.trim()
    || `${process.platform}|${os.hostname()}|${os.homedir()}`;

  function ensureDevice(): string {
    const row = getMeta.get(DEVICE_KEY) as { value: string } | undefined;
    if (row?.value) return row.value;
    const id = `dev_${randomUUID().replaceAll('-', '')}`;
    setMeta.run(DEVICE_KEY, id);
    setMeta.run(FINGERPRINT_KEY, deviceFingerprint);
    return id;
  }

  function assertCanPublish(): void {
    const device = getMeta.get(DEVICE_KEY) as { value: string } | undefined;
    if (!device?.value) {
      ensureDevice();
      return;
    }
    const row = getMeta.get(FINGERPRINT_KEY) as { value: string } | undefined;
    if (!row?.value) throw new Error('[memorix] sync device identity is unknown; run `memorix sync store device rotate` before publishing');
    if (row?.value && row.value !== deviceFingerprint) {
      throw new Error(
        '[memorix] sync device clone detected; run `memorix sync store device rotate` before publishing from this data directory',
      );
    }
  }

  function cursorKey(): string {
    return `cursor:${namespace}`;
  }

  return {
    projectId: () => projectId,
    namespace: () => namespace,
    deviceId: ensureDevice,
    assertCanPublish,
    rotateDevice: () => {
      const previous = ensureDevice();
      const id = `dev_${randomUUID().replaceAll('-', '')}`;
      const pending = pendingForDevice.all(previous) as Array<{
        projectId: string;
        namespace: string;
        sequence: number;
        batchJson: string;
      }>;
      const rotate = db.transaction(() => {
        setMeta.run(DEVICE_KEY, id);
        setMeta.run(FINGERPRINT_KEY, deviceFingerprint);
        // Pending batches were created before the clone was detected. Keep
        // them and move their transport identity to the new replica; deleting
        // them here would silently lose successfully recorded local memory.
        for (const item of pending) {
          const batch = JSON.parse(item.batchJson) as { deviceId?: string } & Record<string, unknown>;
          rewritePendingDevice.run(
            id,
            JSON.stringify({ ...batch, deviceId: id }),
            item.projectId,
            item.namespace,
            previous,
            item.sequence,
          );
        }
      });
      rotate();
      return id;
    },

    async loadCursor(): Promise<SyncCursor> {
      const row = getMeta.get(cursorKey()) as { value: string } | undefined;
      if (!row) return { applied: {} };
      try {
        const value = JSON.parse(row.value) as SyncCursor;
        return value && typeof value.applied === 'object' ? value : { applied: {} };
      } catch {
        return { applied: {} };
      }
    },

    async saveCursor(cursor: SyncCursor): Promise<void> {
      setMeta.run(cursorKey(), JSON.stringify(cursor));
    },

    async loadPendingBatches(): Promise<SyncPendingBatch[]> {
      return (selPending.all(projectId, namespace, ensureDevice()) as Array<{ batchJson: string; statesJson: string }>).map((row) => ({
        batch: JSON.parse(row.batchJson),
        states: JSON.parse(row.statesJson),
      } as SyncPendingBatch));
    },

    async enqueueBatch(pending: SyncPendingBatch): Promise<void> {
      insertPending.run({
        projectId,
        namespace,
        deviceId: pending.batch.deviceId,
        sequence: pending.batch.sequence,
        batchJson: JSON.stringify(pending.batch),
        statesJson: JSON.stringify(pending.states),
        createdAt: pending.batch.producedAt,
      });
    },

    async markBatchShipped(sequence: number): Promise<void> {
      deletePending.run(projectId, namespace, ensureDevice(), sequence);
    },

    async loadAll(): Promise<Observation[]> {
      return store.loadByProject(projectId);
    },

    async loadState(): Promise<Map<string, SyncRowState>> {
      const rows = selState.all(projectId) as SyncRowState[];
      const map = new Map<string, SyncRowState>();
      for (const r of rows) map.set(r.syncKey, r);
      return map;
    },

    async saveState(rows: SyncRowState[]): Promise<void> {
      const tx = db.transaction((batch: SyncRowState[]) => {
        for (const r of batch) upState.run(r);
      });
      tx(rows);
    },

    async allocateId(): Promise<number> {
      return store.atomic(async (tx) => {
        const nextId = await tx.loadIdCounter();
        await tx.saveIdCounter(nextId + 1);
        return nextId;
      });
    },

    async applyInsert(row: Observation, state: SyncRowState): Promise<void> {
      await store.atomic(async (tx) => {
        const existing = await tx.getById(row.id);
        if (existing) {
          if (existing.projectId !== row.projectId) {
            throw new Error('[memorix] sync refused to overwrite an observation from another project');
          }
          throw new Error('[memorix] sync insert collided with an existing local observation id');
        }
        await tx.insert(row);
        upState.run(state);
      });
    },

    async applyUpdate(row: Observation, state: SyncRowState): Promise<void> {
      await store.atomic(async (tx) => {
        const existing = await tx.getById(row.id);
        if (existing && existing.projectId !== row.projectId) {
          throw new Error('[memorix] sync refused to overwrite an observation from another project');
        }
        if (existing) await tx.update(row);
        else await tx.insert(row);
        upState.run(state);
      });
    },

    async applyRemove(id: number, state: SyncRowState): Promise<void> {
      await store.atomic(async (tx) => {
        const existing = await tx.getById(id);
        if (existing && existing.projectId !== state.projectId) {
          throw new Error('[memorix] sync refused to remove an observation from another project');
        }
        await tx.remove(id);
        upState.run(state);
      });
    },

    async getById(id: number): Promise<Observation | undefined> {
      return store.getById(id);
    },

    async recordConflict(conflict: SyncConflict): Promise<void> {
      insertConflict.run({
        id: conflict.id,
        projectId: conflict.projectId,
        syncKey: conflict.syncKey,
        winnerJson: JSON.stringify(conflict.winner),
        loserJson: JSON.stringify({ version: conflict.loser, kind: conflict.loserKind, row: conflict.loserRow }),
        createdAt: conflict.createdAt,
        reason: conflict.reason,
      });
    },

    async nextSequence(): Promise<number> {
      const row = getMeta.get(SEQ_KEY) as { value: string } | undefined;
      const next = (row ? parseInt(row.value, 10) : 0) + 1;
      setMeta.run(SEQ_KEY, String(next));
      return next;
    },
  };
}

function ensureSyncSchema(db: any, projectId: string): void {
  db.exec(CREATE_SYNC_TABLES);
  const columns = db.prepare('PRAGMA table_info(sync_row_state)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'projectId')) {
    // #277 created this table with syncKey as the only primary key. Adding a
    // nullable-by-default project column keeps old stores readable while the
    // composite unique index enables the scoped v3 writer.
    db.exec("ALTER TABLE sync_row_state ADD COLUMN projectId TEXT NOT NULL DEFAULT ''");
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS sync_row_state_project_key ON sync_row_state(projectId, syncKey)');
  db.exec('CREATE INDEX IF NOT EXISTS sync_row_state_project_idx ON sync_row_state(projectId)');
  db.exec('CREATE INDEX IF NOT EXISTS sync_outbox_project_idx ON sync_outbox(projectId, namespace, deviceId, sequence)');

  // Attach legacy live rows to the project they already belong to. Legacy
  // tombstones have no surviving observation from which a project can be
  // inferred, so they remain quarantined under the empty project ID.
  const legacy = db.prepare(
    `SELECT s.syncKey, s.obsId FROM sync_row_state s
     JOIN observations o ON o.id = s.obsId
     WHERE s.projectId = '' AND o.projectId = ?`,
  ).all(projectId) as Array<{ syncKey: string; obsId: number }>;
  const update = db.prepare('UPDATE sync_row_state SET projectId = ? WHERE syncKey = ? AND projectId = ?');
  for (const row of legacy) update.run(projectId, row.syncKey, LEGACY_PROJECT_ID);
}
