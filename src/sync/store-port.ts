/**
 * Binds the sync engine's `SyncStorePort` to the real Memorix store: the
 * canonical `ObservationStore` for rows, plus the additive `sync_row_state` /
 * `sync_meta` tables (created here, never altering `observations`).
 *
 * This is the only place the engine touches persistence in production.
 */
import type { Observation } from '../types.js';
import type { ObservationStore } from '../store/obs-store.js';
import { getDatabase } from '../store/sqlite-db.js';
import { CREATE_SYNC_TABLES } from './journal.js';
import type { SyncStorePort } from './engine.js';
import type { SyncRowState } from './types.js';

const SEQ_KEY = 'local_sequence';
const DEVICE_KEY = 'device_id';

export interface SqliteSyncStore extends SyncStorePort {
  /** Stable device id for this store (generated once, persisted in sync_meta). */
  deviceId(): string;
}

export function createSqliteSyncStore(dataDir: string, store: ObservationStore): SqliteSyncStore {
  const db = getDatabase(dataDir);
  db.exec(CREATE_SYNC_TABLES);
  const getMeta = db.prepare('SELECT value FROM sync_meta WHERE key = ?');
  const setMeta = db.prepare('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)');
  const selState = db.prepare('SELECT syncKey, obsId, revision, writer, kind, contentHash, shippedSeq FROM sync_row_state');
  const upState = db.prepare(
    `INSERT INTO sync_row_state (syncKey, obsId, revision, writer, kind, contentHash, shippedSeq)
     VALUES (@syncKey, @obsId, @revision, @writer, @kind, @contentHash, @shippedSeq)
     ON CONFLICT(syncKey) DO UPDATE SET
       obsId = excluded.obsId,
       revision = excluded.revision,
       writer = excluded.writer,
       kind = excluded.kind,
       contentHash = excluded.contentHash,
       shippedSeq = excluded.shippedSeq`,
  );

  function ensureDevice(): string {
    const row = getMeta.get(DEVICE_KEY) as { value: string } | undefined;
    if (row?.value) return row.value;
    const id = `dev_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    setMeta.run(DEVICE_KEY, id);
    return id;
  }

  return {
    deviceId: ensureDevice,

    async loadAll(): Promise<Observation[]> {
      return store.loadAll();
    },

    async loadState(): Promise<Map<string, SyncRowState>> {
      const rows = selState.all() as SyncRowState[];
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

    async applyInsert(row: Observation): Promise<void> {
      const existing = await store.getById(row.id);
      if (existing) await store.update(row);
      else await store.insert(row);
    },

    async applyUpdate(row: Observation): Promise<void> {
      const existing = await store.getById(row.id);
      if (existing) await store.update(row);
      else await store.insert(row);
    },

    async applyRemove(id: number): Promise<void> {
      await store.remove(id);
    },

    async nextSequence(): Promise<number> {
      const row = getMeta.get(SEQ_KEY) as { value: string } | undefined;
      const next = (row ? parseInt(row.value, 10) : 0) + 1;
      setMeta.run(SEQ_KEY, String(next));
      return next;
    },
  };
}
