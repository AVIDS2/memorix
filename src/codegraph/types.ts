export type CodeGraphProviderKind = 'external' | 'lite';
export type CodeGraphEvidenceProvider = 'lite' | 'semantic' | 'external';

/** The component that produced a persisted code fact. */
export type CodeEvidenceSource = 'lite-regex' | 'typescript-compiler' | 'scip' | 'external';

export type CodeRefStatus = 'current' | 'suspect' | 'stale' | 'unbound';

export type CodeSymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'component'
  | 'constant'
  | 'property'
  | 'route'
  | 'unknown';

export type CodeEdgeType =
  | 'imports'
  | 'exports'
  | 'calls'
  | 'defines'
  | 'tests'
  | 'extends'
  | 'implements'
  | 'routes_to'
  | 'references';

export interface CodeFile {
  id: string;
  projectId: string;
  path: string;
  language?: string;
  contentHash: string;
  mtimeMs?: number;
  sizeBytes?: number;
  indexedAt: string;
  gitCommit?: string;
  source?: CodeEvidenceSource;
  parserError?: string;
  snapshotId?: string;
  sourceEpoch?: number;
}

export interface CodeSymbol {
  id: string;
  projectId: string;
  fileId: string;
  path: string;
  name: string;
  qualifiedName: string;
  kind: CodeSymbolKind;
  startLine?: number;
  endLine?: number;
  signature?: string;
  contentHash?: string;
  indexedAt: string;
  stale?: boolean;
  source?: CodeEvidenceSource;
  snapshotId?: string;
  sourceEpoch?: number;
}

export interface CodeEdge {
  id: string;
  projectId: string;
  fromSymbolId?: string;
  toSymbolId?: string;
  fromFileId?: string;
  toFileId?: string;
  type: CodeEdgeType;
  confidence: number;
  evidence?: string;
  source?: CodeEvidenceSource;
  indexedAt: string;
  snapshotId?: string;
  sourceEpoch?: number;
}

export interface ObservationCodeRef {
  id: string;
  projectId: string;
  observationId: number;
  fileId?: string;
  symbolId?: string;
  capturedFileHash?: string;
  capturedSymbolHash?: string;
  status: CodeRefStatus;
  reason?: string;
  createdAt: string;
  updatedAt?: string;
  snapshotId?: string;
}

export type CodeStateWorktreeState = 'clean' | 'dirty' | 'unavailable';

export interface CodeStateScanCompleteness {
  scannedFiles: number;
  maxFiles: number;
  changedFiles: number;
  unchangedFiles: number;
  metadataOnlyFiles: number;
  removedFiles: number;
  skippedOversizedFiles: number;
  /** Source paths discovered but unavailable for stat/read during this scan. */
  unreadableFiles?: number;
  removalScanDeferred: boolean;
}

export interface CodeStateSnapshotInput {
  projectId: string;
  provider: CodeGraphProviderKind;
  baseRevision?: string;
  worktreeFingerprint: string;
  worktreeState: CodeStateWorktreeState;
  changedPathCount: number;
  indexedAt: string;
  completeness: CodeStateScanCompleteness;
}

export interface CodeStateSnapshot extends CodeStateSnapshotInput {
  id: string;
  sourceEpoch: number;
  previousSnapshotId?: string;
}

/** Hash-only file state retained for an explicit Code State snapshot. */
export interface CodeStateSnapshotFile {
  snapshotId: string;
  projectId: string;
  fileId: string;
  path: string;
  contentHash: string;
}

export interface CodeStateFileChange {
  path: string;
  kind: 'added' | 'modified' | 'removed';
  beforeHash?: string;
  afterHash?: string;
}

/**
 * An exact file-level comparison when both snapshots have hash manifests.
 * It intentionally makes no claim about source-level semantic equivalence.
 */
export interface CodeStateDiff {
  projectId: string;
  fromSnapshotId: string;
  toSnapshotId: string;
  available: boolean;
  reason?: 'missing-snapshot' | 'project-mismatch' | 'legacy-snapshot-without-manifest' | 'incomplete-snapshot';
  changes: CodeStateFileChange[];
}

/** Bounded one-hop structural evidence around changed file paths. */
export interface CodeGraphImpactSlice {
  projectId: string;
  snapshotId?: string;
  changedPaths: string[];
  directlyConnectedPaths: string[];
  relationCount: number;
  truncated: boolean;
  provider: CodeGraphProviderKind;
}

export interface CodeGraphStatus {
  provider: CodeGraphProviderKind;
  files: number;
  symbols: number;
  edges: number;
  refs: number;
  semanticSymbols: number;
  semanticEdges: number;
  parserErrors: number;
  indexedAt?: string;
  latestSnapshot?: CodeStateSnapshot;
}

/** Policy for using a separately installed, local semantic CodeGraph index. */
export type CodeGraphExternalMode = 'auto' | 'off';

/**
 * The external provider state is deliberately more precise than a boolean.
 * A caller can distinguish an absent optional tool from a stale or invalid
 * result without treating either as a fatal failure for Code Memory.
 */
export type ExternalCodeGraphState =
  | 'disabled'
  | 'not-detected'
  | 'unavailable'
  | 'not-initialized'
  | 'stale'
  | 'timed-out'
  | 'invalid'
  | 'ready';

export interface ExternalCodeGraphHealth {
  state: ExternalCodeGraphState;
  reason?: string;
  indexedFiles?: number;
  indexedNodes?: number;
  indexedEdges?: number;
  languages?: string[];
}

export interface CodeGraphProviderQuality {
  /** Provider that contributed task-scoped code evidence to this response. */
  selected: CodeGraphEvidenceProvider;
  /** Lite is heuristic; external outlines are only semantic after validation. */
  selectedQuality: 'heuristic' | 'semantic';
  mode: CodeGraphExternalMode;
  lite: {
    quality: 'heuristic';
    capabilities: {
      declarations: boolean;
      importHints: boolean;
      /** Deterministic local-path mapping only; not semantic name resolution. */
      localRelativeImportTargets: boolean;
      resolvedRelations: false;
      exactLocations: false;
    };
    supportedLanguages: string[];
  };
  external: ExternalCodeGraphHealth;
  semantic: {
    state: 'not-indexed' | 'ready' | 'partial';
    symbols: number;
    edges: number;
    parserErrors: number;
  };
}

export interface ExternalCodeGraphSymbol {
  id: string;
  name: string;
  qualifiedName?: string;
  kind: string;
  path: string;
  startLine?: number;
  endLine?: number;
  language?: string;
}

export interface ExternalCodeGraphRelation {
  from: ExternalCodeGraphSymbol;
  to: ExternalCodeGraphSymbol;
  kind: string;
  line?: number;
}

/** A bounded, non-source-code semantic outline returned for one task. */
export interface CodeGraphOutline {
  provider: 'semantic' | 'external';
  entryPoints: ExternalCodeGraphSymbol[];
  relations: ExternalCodeGraphRelation[];
  relatedFiles: string[];
  stats: {
    nodes: number;
    edges: number;
    files: number;
  };
}

export type ExternalCodeGraphOutline = CodeGraphOutline & { provider: 'external' };
