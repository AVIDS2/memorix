import type { DerivedView } from '../core/derived-view.js';
import { closeDatabase, getDatabase } from '../store/sqlite-db.js';
import {
  isObservationLexicalIndexEnabled,
  rebuildObservationLexicalIndex,
} from '../store/sqlite-fts.js';

export interface FtsRefreshInput {
  rebuild?: boolean;
}

/** SQLite FTS5 derived view over canonical observations. */
export function createFtsDerivedView(dataDir: string): DerivedView<FtsRefreshInput> {
  const rowCount = (db: any): number => Number(
    db.prepare('SELECT COUNT(*) AS count FROM observations_fts').get()?.count ?? 0,
  );

  return {
    async status() {
      try {
        const db = getDatabase(dataDir);
        if (!isObservationLexicalIndexEnabled(db)) {
          return { state: 'unavailable', reason: 'SQLite FTS5 is unavailable' };
        }
        const observationCount = Number(db.prepare('SELECT COUNT(*) AS count FROM observations').get()?.count ?? 0);
        const indexedCount = rowCount(db);
        return indexedCount === observationCount
          ? { state: 'ready', rowCount: indexedCount }
          : { state: 'stale', rowCount: indexedCount, reason: 'FTS row count differs from canonical observations' };
      } catch (error) {
        return { state: 'degraded', reason: error instanceof Error ? error.message : String(error) };
      }
    },
    async refresh(input) {
      if (!input.rebuild) return;
      const db = getDatabase(dataDir);
      if (!isObservationLexicalIndexEnabled(db) || !rebuildObservationLexicalIndex(db)) {
        throw new Error('SQLite FTS5 rebuild is unavailable');
      }
    },
    async rebuild() {
      const db = getDatabase(dataDir);
      return isObservationLexicalIndexEnabled(db) && rebuildObservationLexicalIndex(db);
    },
    async compact() {
      // FTS5 external-content tables are compacted by rebuild; there is no
      // separate vacuum-like operation that should run in a request handler.
    },
    async close() {
      closeDatabase(dataDir);
    },
  };
}
