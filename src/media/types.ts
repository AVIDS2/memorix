export type MediaKind = 'image' | 'audio' | 'video' | 'document';

export type MediaSourceKind =
  | 'import'
  | 'minimax-image'
  | 'minimax-video';

export type MediaLinkRole = 'source' | 'generated' | 'attachment';

export type MediaDerivationKind = 'description' | 'ocr' | 'embedding' | 'pdf-text' | 'audio-transcript';

export interface MediaDerivationMetadata {
  extractor?: string;
  provider?: string;
  model?: string;
  sourceAssetId?: string;
  responseFormat?: string;
  durationSeconds?: number;
  billing?: {
    /** Providers may report usage but not a stable monetary amount. */
    costStatus: 'not-reported';
    inputAudioSeconds?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  pageCount?: number;
  processedPages?: number;
  chunkCount?: number;
  truncated?: boolean;
  maxPages?: number;
  maxChars?: number;
}

export type MediaJobKind = 'minimax-video-generation' | 'audio-transcription';

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
  metadata?: MediaDerivationMetadata;
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
  /** The controlled local asset consumed by this job, if any. */
  sourceAssetId?: string;
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
