import type { DerivedView } from '../core/derived-view.js';
import type { Observation } from '../types.js';
import {
  countIndexedDocuments,
  getDb,
  hydrateIndex,
  resetDb,
} from '../store/orama-store.js';
import { reindexObservations, getSearchIndexStatus } from '../memory/observations.js';

/** In-process Orama view; SQLite remains the canonical source of records. */
export function createOramaDerivedView(): DerivedView<Observation[]> {
  return {
    async status() {
      try {
        const database = await getDb({ allowNetworkProbe: false });
        const status = getSearchIndexStatus();
        const rowCount = await countIndexedDocuments(database);
        return status.prepared || rowCount > 0
          ? { state: 'ready', rowCount }
          : { state: 'missing', rowCount };
      } catch (error) {
        return { state: 'degraded', reason: error instanceof Error ? error.message : String(error) };
      }
    },
    async refresh(observations) {
      await resetDb();
      await hydrateIndex(observations, { allowNetworkProbe: false, skipCachedVectors: true });
    },
    async rebuild() {
      return (await reindexObservations()) > 0;
    },
    async compact() {
      // Orama has no durable compaction phase; rebuild is the explicit repair.
    },
    async close() {
      await resetDb();
    },
  };
}
