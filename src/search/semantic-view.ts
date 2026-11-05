import type { DerivedView } from '../core/derived-view.js';
import {
  closeSemanticIndexProfile,
  ensureSemanticIndex,
  getSemanticIndexStats,
  isSemanticIndexAvailable,
  optimizeSemanticIndex,
  upsertSemanticVector,
  upsertSemanticVectors,
  type SemanticIndexProfile,
  type SemanticVectorRecord,
} from './semantic-index.js';

export function createSemanticDerivedView(
  dataDir: string,
  profile: SemanticIndexProfile,
): DerivedView<SemanticVectorRecord[]> {
  return {
    async status() {
      if (!(await isSemanticIndexAvailable())) return { state: 'unavailable' };
      const stats = await getSemanticIndexStats(dataDir, profile);
      return stats
        ? { state: 'ready', generation: stats.version, rowCount: stats.rowCount }
        : { state: 'missing' };
    },
    async refresh(records) {
      if (records.length === 1) await upsertSemanticVector(dataDir, profile, records[0]);
      else await upsertSemanticVectors(dataDir, profile, records);
    },
    rebuild: () => ensureSemanticIndex(dataDir, profile),
    compact: () => optimizeSemanticIndex(dataDir, profile),
    close: () => closeSemanticIndexProfile(dataDir, profile),
  };
}
