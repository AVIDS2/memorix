import { CodeGraphStore } from './store.js';

export interface CodeGraphDashboardStatus {
  projectId: string;
  provider: 'lite';
  state: 'not-indexed' | 'ready' | 'partial';
  files: number;
  symbols: number;
  edges: number;
  refs: number;
  indexedAt?: string;
  semantic: {
    files: number;
    symbols: number;
    edges: number;
    parserErrors: number;
  };
  lite: {
    files: number;
    symbols: number;
    edges: number;
  };
  parserErrorPaths: string[];
  snapshot?: {
    id: string;
    sourceEpoch: number;
    worktreeState: string;
    incomplete: boolean;
    changedPathCount: number;
  };
}

/** Read-only dashboard projection; it never refreshes or mutates the index. */
export async function getCodeGraphDashboardStatus(
  dataDir: string,
  projectId: string,
): Promise<CodeGraphDashboardStatus> {
  const store = new CodeGraphStore();
  await store.init(dataDir);
  const status = store.status(projectId);
  const files = store.listFiles(projectId);
  const semanticFiles = files.filter(file => file.source === 'typescript-compiler');
  const parserErrorPaths = files
    .filter(file => Boolean(file.parserError))
    .map(file => file.path)
    .slice(0, 8);
  const semanticIndexed = status.semanticSymbols > 0 || status.semanticEdges > 0;
  const snapshot = status.latestSnapshot;
  return {
    projectId,
    provider: 'lite',
    state: status.parserErrors > 0 ? 'partial' : semanticIndexed ? 'ready' : 'not-indexed',
    files: status.files,
    symbols: status.symbols,
    edges: status.edges,
    refs: status.refs,
    ...(status.indexedAt ? { indexedAt: status.indexedAt } : {}),
    semantic: {
      files: semanticFiles.length,
      symbols: status.semanticSymbols,
      edges: status.semanticEdges,
      parserErrors: status.parserErrors,
    },
    lite: {
      files: files.length - semanticFiles.length,
      symbols: Math.max(0, status.symbols - status.semanticSymbols),
      edges: Math.max(0, status.edges - status.semanticEdges),
    },
    parserErrorPaths,
    ...(snapshot ? {
      snapshot: {
        id: snapshot.id,
        sourceEpoch: snapshot.sourceEpoch,
        worktreeState: snapshot.worktreeState,
        incomplete: snapshot.completeness.skippedOversizedFiles > 0
          || (snapshot.completeness.unreadableFiles ?? 0) > 0
          || snapshot.completeness.removalScanDeferred,
        changedPathCount: snapshot.changedPathCount,
      },
    } : {}),
  };
}
