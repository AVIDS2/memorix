import type { Observation, ObservationReader, ObservationVisibility } from '../types.js';
import { storeObservation } from '../memory/observations.js';
import { MediaStore } from './media-store.js';
import type { MediaAsset, MediaLinkRole } from './types.js';

export interface AttachMediaAssetInput {
  dataDir: string;
  projectId: string;
  asset: MediaAsset;
  title: string;
  narrative?: string;
  facts?: string[];
  concepts?: string[];
  entityName?: string;
  role?: MediaLinkRole;
  visibility?: ObservationVisibility;
  createdByAgentId?: string;
  visibilityReader?: ObservationReader;
}

/**
 * Create normal text retrieval evidence first, then add an explicit asset link.
 * The media row remains the binary source of truth; the Observation is only a
 * small, auditable retrieval projection.
 */
export async function attachMediaAssetToObservation(input: AttachMediaAssetInput): Promise<Observation> {
  const asset = input.asset;
  const sourceLabel = asset.sourceLabel ?? `${asset.kind} asset`;
  const narrative = input.narrative?.trim()
    || `Attached ${asset.kind} asset ${sourceLabel} (${asset.mimeType}, ${asset.byteSize} bytes).`;
  const facts = [
    `Media asset: ${asset.id}`,
    `Media kind: ${asset.kind}`,
    `MIME type: ${asset.mimeType}`,
    ...(input.facts ?? []),
  ];
  const result = await storeObservation({
    entityName: input.entityName?.trim() || sourceLabel.replace(/\.[^.]+$/, '') || 'media-asset',
    type: 'discovery',
    title: input.title.trim() || `Media asset: ${sourceLabel}`,
    narrative,
    facts,
    concepts: ['media', asset.kind, asset.mimeType, ...(input.concepts ?? [])],
    projectId: input.projectId,
    source: 'manual',
    sourceDetail: 'explicit',
    ...(input.visibility ? { visibility: input.visibility } : {}),
    ...(input.createdByAgentId ? { createdByAgentId: input.createdByAgentId } : {}),
    ...(input.visibilityReader ? { visibilityReader: input.visibilityReader } : {}),
  });
  new MediaStore(input.dataDir).linkAsset({
    projectId: input.projectId,
    assetId: asset.id,
    observationId: result.observation.id,
    role: input.role ?? 'attachment',
  });
  return result.observation;
}
