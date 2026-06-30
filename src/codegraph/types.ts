export type CodeGraphProviderKind = 'external' | 'lite';

export type CodeRefStatus = 'current' | 'suspect' | 'stale' | 'unbound';

export type CodeSymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'component'
  | 'constant'
  | 'route'
  | 'unknown';

export type CodeEdgeType =
  | 'imports'
  | 'exports'
  | 'calls'
  | 'defines'
  | 'tests'
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
  indexedAt: string;
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
}

export interface CodeGraphStatus {
  provider: CodeGraphProviderKind;
  files: number;
  symbols: number;
  edges: number;
  refs: number;
  indexedAt?: string;
}
