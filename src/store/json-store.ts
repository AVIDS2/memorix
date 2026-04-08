/**
 * JsonBackend — ObservationStore implementation backed by observations.json + file-lock.
 *
 * This is a mechanical wrap of the existing persistence model into the ObservationStore
 * interface. Behavior is identical to pre-abstraction code:
 *   - read-all / mutate / write-all inside withFileLock
 *   - counter.json for next-ID tracking
 *   - ensureFresh() is a no-op (every write already re-reads from disk)
 */

import type { Observation } from '../types.js';
import type { ObservationStore, StoreTransaction } from './obs-store.js';
import {
  saveObservationsJson, loadObservationsJson,
  saveIdCounter as persistSaveIdCounter,
  loadIdCounter as persistLoadIdCounter,
} from './persistence.js';
import { withFileLock } from './file-lock.js';

export class JsonBackend implements ObservationStore {
  private dataDir: string = '';

  async init(dataDir: string): Promise<void> {
    this.dataDir = dataDir;
  }

  // ── Raw helpers (no lock) ────────────────────────────────────────

  private rawLoadAll(): Promise<Observation[]> {
    return loadObservationsJson(this.dataDir) as Promise<Observation[]>;
  }

  private rawSaveAll(obs: Observation[]): Promise<void> {
    return saveObservationsJson(this.dataDir, obs);
  }

  private rawLoadIdCounter(): Promise<number> {
    return persistLoadIdCounter(this.dataDir);
  }

  private rawSaveIdCounter(nextId: number): Promise<void> {
    return persistSaveIdCounter(this.dataDir, nextId);
  }

  // ── Public read ──────────────────────────────────────────────────

  async loadAll(): Promise<Observation[]> {
    return this.rawLoadAll();
  }

  async loadIdCounter(): Promise<number> {
    return this.rawLoadIdCounter();
  }

  // ── Public write (each acquires its own lock) ────────────────────

  async insert(obs: Observation): Promise<void> {
    await withFileLock(this.dataDir, async () => {
      const all = await this.rawLoadAll();
      all.push(obs);
      await this.rawSaveAll(all);
    });
  }

  async update(obs: Observation): Promise<void> {
    await withFileLock(this.dataDir, async () => {
      const all = await this.rawLoadAll();
      const idx = all.findIndex(o => o.id === obs.id);
      if (idx >= 0) {
        all[idx] = obs;
      } else {
        all.push(obs);
      }
      await this.rawSaveAll(all);
    });
  }

  async remove(id: number): Promise<void> {
    await withFileLock(this.dataDir, async () => {
      const all = await this.rawLoadAll();
      const filtered = all.filter(o => o.id !== id);
      await this.rawSaveAll(filtered);
    });
  }

  async bulkReplace(obs: Observation[]): Promise<void> {
    await withFileLock(this.dataDir, async () => {
      await this.rawSaveAll(obs);
    });
  }

  async bulkRemoveByIds(ids: number[]): Promise<void> {
    const idSet = new Set(ids);
    await withFileLock(this.dataDir, async () => {
      const all = await this.rawLoadAll();
      const filtered = all.filter(o => !idSet.has(o.id));
      await this.rawSaveAll(filtered);
    });
  }

  async saveIdCounter(nextId: number): Promise<void> {
    await this.rawSaveIdCounter(nextId);
  }

  // ── Compound atomic operation ────────────────────────────────────

  async atomic<T>(fn: (tx: StoreTransaction) => Promise<T>): Promise<T> {
    return withFileLock(this.dataDir, async () => {
      const tx: StoreTransaction = {
        loadAll: () => this.rawLoadAll(),
        loadIdCounter: () => this.rawLoadIdCounter(),
        saveAll: (obs) => this.rawSaveAll(obs),
        saveIdCounter: (nextId) => this.rawSaveIdCounter(nextId),
      };
      return fn(tx);
    });
  }

  // ── Freshness ────────────────────────────────────────────────────

  async ensureFresh(): Promise<boolean> {
    // JSON backend: every write re-reads from disk inside file lock,
    // so cross-process freshness is handled implicitly. No-op here.
    return false;
  }

  getGeneration(): number {
    // JSON backend has no generation tracking — always 0.
    return 0;
  }

  close(): void {
    // JSON backend has no resources to release.
  }

  getBackendName(): 'sqlite' | 'json' {
    return 'json';
  }
}
