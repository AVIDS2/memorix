export type MediaKind = 'image' | 'audio' | 'video' | 'document';

export type MediaSourceKind =
  | 'import'
  | 'minimax-image'
  | 'minimax-video';

export type MediaLinkRole = 'source' | 'generated' | 'attachment';

export type MediaDerivationKind = 'description' | 'ocr' | 'embedding';

export type MediaJobKind = 'minimax-video-generation';

export type MediaJobStatus =
  | 'queued'
  | 'submitting'
  | 'provider-pending'
  | 'downloading'
  | 'completed'
  | 'retry'
  | 'failed'
  | 'cancelled';

export interface MediaAsset {
  id: string;
  projectId: string;
  sha256: string;
  kind: MediaKind;
  mimeType: string;
  byteSize: number;
  /** Relative to the project-independent `media` directory under Memorix data. */
  storageRelPath: string;
  sourceKind: MediaSourceKind;
  /** Human-readable source name only. Never a signed or credential-bearing URL. */
  sourceLabel?: string;
  provider?: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface MediaAssetLink {
  id: string;
  assetId: string;
  projectId: string;
  observationId?: number;
  role: MediaLinkRole;
  createdAt: number;
}

export interface MediaDerivation {
  id: string;
  assetId: string;
  projectId: string;
  kind: MediaDerivationKind;
  /** Embedding profile key for vector derivations; absent for textual data. */
  profileKey?: string;
  content: string;
  status: 'ready' | 'failed';
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MediaEmbeddingProfile {
  key: string;
  provider: string;
  model: string;
  dimensions: number;
  modality: MediaKind;
  createdAt: number;
}

export interface MediaEmbedding {
  assetId: string;
  projectId: string;
  profileKey: string;
  intent: 'document';
  dimensions: number;
  vector: number[];
  createdAt: number;
  updatedAt: number;
}

export interface MediaJob {
  id: string;
  projectId: string;
  kind: MediaJobKind;
  status: MediaJobStatus;
  request: Record<string, unknown>;
  providerTaskId?: string;
  assetId?: string;
  lastError?: string;
  attempts: number;
  attachOnComplete: boolean;
  observationTitle?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface MediaImportResult {
  asset: MediaAsset;
  deduplicated: boolean;
}

export const DEFAULT_MAX_MEDIA_BYTES = 100 * 1024 * 1024;
export const DEFAULT_MEDIA_QUOTA_BYTES = 1024 * 1024 * 1024;
