import { createHash } from 'node:crypto';

import {
  getEmbeddingProvider,
  type EmbeddingProvider,
} from '../embedding/provider.js';
import { readMediaAsset } from './asset-store.js';
import { MediaStore } from './media-store.js';
import type { MediaAsset } from './types.js';

export type MediaEmbeddingOutcome =
  | {
    status: 'embedded';
    asset: MediaAsset;
    profileKey: string;
    dimensions: number;
  }
  | {
    status: 'unsupported' | 'unavailable';
    asset: MediaAsset;
    reason: string;
  };

export interface EmbedMediaAssetInput {
  dataDir: string;
  projectId: string;
  assetId: string;
  timeoutMs?: number;
}

export interface SimilarMediaAsset {
  asset: MediaAsset;
  score: number;
  profileKey: string;
}

function profileKey(provider: EmbeddingProvider, asset: MediaAsset): string {
  const identity = `${provider.name}\u0000${provider.dimensions}\u0000${asset.kind}`;
  return `media:${createHash('sha256').update(identity).digest('hex').slice(0, 20)}`;
}

function supportsAsset(provider: EmbeddingProvider, asset: MediaAsset): boolean {
  return !!provider.embedInput && (provider.supportedModalities?.includes(asset.kind) ?? false);
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return Number.NEGATIVE_INFINITY;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return Number.NEGATIVE_INFINITY;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

export async function embedMediaAsset(
  input: EmbedMediaAssetInput,
  dependencies: { provider?: EmbeddingProvider | null } = {},
): Promise<MediaEmbeddingOutcome> {
  const store = new MediaStore(input.dataDir);
  const asset = store.getAsset(input.projectId, input.assetId);
  if (!asset) throw new Error(`Media asset not found: ${input.assetId}`);
  const provider = dependencies.provider ?? await getEmbeddingProvider({
    requestTimeoutMs: input.timeoutMs,
    retry: false,
  });
  if (!provider) {
    return {
      status: 'unavailable',
      asset,
      reason: 'No embedding provider is configured; lexical media descriptions remain available.',
    };
  }
  if (!supportsAsset(provider, asset)) {
    return {
      status: 'unsupported',
      asset,
      reason: `Embedding provider ${provider.name} does not declare ${asset.kind} support; no media vector was written.`,
    };
  }

  const bytes = await readMediaAsset(input.dataDir, asset);
  const vector = await provider.embedInput!(
    { modality: asset.kind, data: bytes.toString('base64'), mimeType: asset.mimeType },
    { intent: 'document', timeoutMs: input.timeoutMs, retry: false },
  );
  if (vector.length !== provider.dimensions) {
    throw new Error(`Media embedding dimension mismatch: provider declared ${provider.dimensions}, returned ${vector.length}`);
  }
  const key = profileKey(provider, asset);
  store.upsertEmbeddingProfile({
    key,
    provider: provider.name,
    model: provider.name,
    dimensions: provider.dimensions,
    modality: asset.kind,
  });
  store.upsertEmbedding({
    assetId: asset.id,
    projectId: input.projectId,
    profileKey: key,
    intent: 'document',
    dimensions: provider.dimensions,
    vector,
  });
  store.addDerivation({
    assetId: asset.id,
    projectId: input.projectId,
    kind: 'embedding',
    profileKey: key,
    content: `Embedded ${asset.kind} with ${provider.name} (${provider.dimensions} dimensions).`,
    status: 'ready',
  });
  return { status: 'embedded', asset, profileKey: key, dimensions: provider.dimensions };
}

export function findSimilarMediaAssets(input: {
  dataDir: string;
  projectId: string;
  assetId: string;
  limit?: number;
}): SimilarMediaAsset[] {
  const store = new MediaStore(input.dataDir);
  const asset = store.getAsset(input.projectId, input.assetId);
  if (!asset) throw new Error(`Media asset not found: ${input.assetId}`);
  const profiles = store.listDerivations(input.projectId, asset.id)
    .filter((item) => item.kind === 'embedding' && item.status === 'ready' && item.profileKey)
    .map((item) => item.profileKey!);
  if (profiles.length === 0) return [];
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 10)));
  const matches: SimilarMediaAsset[] = [];
  for (const key of new Set(profiles)) {
    const embeddings = store.listEmbeddings(input.projectId, key);
    const query = embeddings.find((embedding) => embedding.assetId === asset.id);
    if (!query) continue;
    for (const candidate of embeddings) {
      if (candidate.assetId === asset.id || candidate.dimensions !== query.dimensions) continue;
      const candidateAsset = store.getAsset(input.projectId, candidate.assetId);
      if (!candidateAsset || candidateAsset.kind !== asset.kind) continue;
      const score = cosineSimilarity(query.vector, candidate.vector);
      if (!Number.isFinite(score)) continue;
      matches.push({ asset: candidateAsset, score, profileKey: key });
    }
  }
  return matches.sort((left, right) => right.score - left.score).slice(0, limit);
}
