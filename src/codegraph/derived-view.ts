import type { DerivedView } from '../core/derived-view.js';
import { closeDatabase } from '../store/sqlite-db.js';
import { CodeGraphStore } from './store.js';
import { refreshProjectLite } from './lite-provider.js';

export interface CodeGraphRefreshInput {
  projectId: string;
  projectRoot: string;
  exclude?: readonly string[];
  maxFiles?: number;
  maxFileBytes?: number;
}

/** CodeGraph Memory lifecycle adapter over the canonical SQLite graph tables. */
export function createCodeGraphDerivedView(dataDir: string): DerivedView<CodeGraphRefreshInput> {
  let store: CodeGraphStore | undefined;
  let lastInput: CodeGraphRefreshInput | undefined;

  const getStore = async (): Promise<CodeGraphStore> => {
    if (!store) {
      store = new CodeGraphStore();
      await store.init(dataDir);
    }
    return store;
  };

  return {
    async status() {
      if (!lastInput) return { state: 'missing' };
      try {
        const status = (await getStore()).status(lastInput.projectId);
        return status.indexedAt
          ? { state: 'ready', generation: status.latestSnapshot?.sourceEpoch, rowCount: status.files }
          : { state: 'missing', rowCount: status.files };
      } catch (error) {
        return { state: 'degraded', reason: error instanceof Error ? error.message : String(error) };
      }
    },
    async refresh(input) {
      lastInput = { ...input, ...(input.exclude ? { exclude: [...input.exclude] } : {}) };
      await refreshProjectLite(await getStore(), {
        ...lastInput,
        exclude: lastInput.exclude ? [...lastInput.exclude] : undefined,
      });
    },
    async rebuild() {
      if (!lastInput) return false;
      await refreshProjectLite(await getStore(), {
        ...lastInput,
        exclude: lastInput.exclude ? [...lastInput.exclude] : undefined,
      });
      return true;
    },
    async compact() {
      store?.compactStorage();
    },
    async close() {
      closeDatabase(dataDir);
      store = undefined;
      lastInput = undefined;
    },
  };
}
