import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { sanitizeCredentials } from '../memory/secret-filter.js';
import { MediaStore } from './media-store.js';
import {
  DEFAULT_MAX_MEDIA_BYTES,
  DEFAULT_MEDIA_QUOTA_BYTES,
  type MediaAsset,
  type MediaImportResult,
  type MediaKind,
  type MediaSourceKind,
} from './types.js';

interface DetectedMedia {
  kind: MediaKind;
  mimeType: string;
  extension: string;
}

export interface ImportMediaFileInput {
  dataDir: string;
  projectId: string;
  filePath: string;
  sourceKind?: MediaSourceKind;
  sourceLabel?: string;
  provider?: string;
  model?: string;
  maxBytes?: number;
}

export interface ImportMediaBufferInput {
  dataDir: string;
  projectId: string;
  bytes: Buffer;
  filename?: string;
  sourceKind: MediaSourceKind;
  sourceLabel?: string;
  provider?: string;
  model?: string;
  maxBytes?: number;
}

function mediaRoot(dataDir: string): string {
  return path.resolve(dataDir, 'media');
}

function projectStorageKey(projectId: string): string {
  return createHash('sha256').update(projectId).digest('hex').slice(0, 16);
}

function validateUnderRoot(root: string, candidate: string): string {
  const resolved = path.resolve(candidate);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Media storage path escaped the Memorix data directory');
  }
  return resolved;
}

function sanitizeLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const basename = sanitizeCredentials(path.basename(value))
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .trim();
  return basename ? basename.slice(0, 180) : undefined;
}

function matchesPrefix(bytes: Buffer, prefix: number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function detectMedia(bytes: Buffer): DetectedMedia {
  if (matchesPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'image', mimeType: 'image/png', extension: '.png' };
  }
  if (matchesPrefix(bytes, [0xff, 0xd8, 0xff])) {
    return { kind: 'image', mimeType: 'image/jpeg', extension: '.jpg' };
  }
  if (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return { kind: 'image', mimeType: 'image/gif', extension: '.gif' };
  }
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { kind: 'image', mimeType: 'image/webp', extension: '.webp' };
  }
  if (bytes.subarray(0, 4).toString('ascii') === '%PDF') {
    return { kind: 'document', mimeType: 'application/pdf', extension: '.pdf' };
  }
  if (bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    return { kind: 'video', mimeType: 'video/mp4', extension: '.mp4' };
  }
  if (matchesPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { kind: 'video', mimeType: 'video/webm', extension: '.webm' };
  }
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') {
    return { kind: 'audio', mimeType: 'audio/wav', extension: '.wav' };
  }
  if (matchesPrefix(bytes, [0x49, 0x44, 0x33]) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return { kind: 'audio', mimeType: 'audio/mpeg', extension: '.mp3' };
  }
  throw new Error('Unsupported or unrecognized media format');
}

async function readHeader(filePath: string, bytes = 32): Promise<Buffer> {
  const handle = await open(filePath, 'r');
  try {
    const output = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(output, 0, bytes, 0);
    return output.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function sha256File(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

function destinationFor(root: string, projectId: string, sha256: string, extension: string): { absolute: string; relative: string } {
  const relative = path.join('assets', projectStorageKey(projectId), sha256.slice(0, 2), `${sha256}${extension}`);
  return { relative, absolute: validateUnderRoot(root, path.join(root, relative)) };
}

function deletionStagingPath(root: string, assetId: string): string {
  return validateUnderRoot(root, path.join(root, '.trash', `${assetId}.${randomUUID()}.pending-delete`));
}

async function destinationExists(destination: string): Promise<boolean> {
  try {
    await lstat(destination);
    return true;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function persistFile(source: string, destination: string): Promise<boolean> {
  await mkdir(path.dirname(destination), { recursive: true });
  if (await destinationExists(destination)) return false;

  // The source is copied to a unique temporary neighbor and atomically renamed.
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await copyFile(source, temporary);
    await rename(temporary, destination);
    return true;
  } catch (error: any) {
    if (error?.code === 'EEXIST' && await destinationExists(destination)) return false;
    throw error;
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function persistBuffer(bytes: Buffer, destination: string): Promise<boolean> {
  await mkdir(path.dirname(destination), { recursive: true });
  if (await destinationExists(destination)) return false;

  // Write through a temporary sibling so an interrupted process cannot create a valid database row for a partial file.
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, destination);
    return true;
  } catch (error: any) {
    if (error?.code === 'EEXIST' && await destinationExists(destination)) return false;
    throw error;
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export function getMediaAssetPath(dataDir: string, asset: MediaAsset): string {
  return validateUnderRoot(mediaRoot(dataDir), path.join(mediaRoot(dataDir), asset.storageRelPath));
}

async function importKnownMedia(input: {
  dataDir: string;
  projectId: string;
  sha256: string;
  bytes: number;
  detected: DetectedMedia;
  persist: (destination: string) => Promise<boolean>;
  sourceKind: MediaSourceKind;
  sourceLabel?: string;
  provider?: string;
  model?: string;
}): Promise<MediaImportResult> {
  const root = mediaRoot(input.dataDir);
  const destination = destinationFor(root, input.projectId, input.sha256, input.detected.extension);
  const createdFile = await input.persist(destination.absolute);
  const store = new MediaStore(input.dataDir);
  try {
    return store.createOrReviveAsset({
      projectId: input.projectId,
      sha256: input.sha256,
      kind: input.detected.kind,
      mimeType: input.detected.mimeType,
      byteSize: input.bytes,
      storageRelPath: destination.relative,
      sourceKind: input.sourceKind,
      sourceLabel: sanitizeLabel(input.sourceLabel),
      provider: input.provider,
      model: input.model,
    });
  } catch (error) {
    // Never remove a pre-existing content-addressed file because a later database
    // operation failed. It may belong to a valid deduplicated asset record.
    if (createdFile) await rm(destination.absolute, { force: true }).catch(() => {});
    throw error;
  }
}

export async function importMediaFile(input: ImportMediaFileInput): Promise<MediaImportResult> {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_MEDIA_BYTES;
  const source = path.resolve(input.filePath);
  const stat = await lstat(source);
  if (stat.isSymbolicLink()) throw new Error('Media import does not follow symbolic links');
  if (!stat.isFile()) throw new Error('Media import accepts regular files only');
  if (stat.size <= 0) throw new Error('Media import rejects empty files');
  if (stat.size > maxBytes) throw new Error(`Media file is too large (${stat.size} bytes; limit ${maxBytes})`);
  const header = await readHeader(source);
  const detected = detectMedia(header);
  const sha256 = await sha256File(source);
  return importKnownMedia({
    dataDir: input.dataDir,
    projectId: input.projectId,
    sha256,
    bytes: stat.size,
    detected,
    persist: (destination) => persistFile(source, destination),
    sourceKind: input.sourceKind ?? 'import',
    sourceLabel: input.sourceLabel ?? path.basename(source),
    provider: input.provider,
    model: input.model,
  });
}

export async function importMediaBuffer(input: ImportMediaBufferInput): Promise<MediaImportResult> {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_MEDIA_BYTES;
  if (input.bytes.length === 0) throw new Error('Media import rejects empty payloads');
  if (input.bytes.length > maxBytes) throw new Error(`Media payload is too large (${input.bytes.length} bytes; limit ${maxBytes})`);
  const detected = detectMedia(input.bytes.subarray(0, 32));
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  return importKnownMedia({
    dataDir: input.dataDir,
    projectId: input.projectId,
    sha256,
    bytes: input.bytes.length,
    detected,
    persist: (destination) => persistBuffer(input.bytes, destination),
    sourceKind: input.sourceKind,
    sourceLabel: input.sourceLabel ?? input.filename,
    provider: input.provider,
    model: input.model,
  });
}

export async function readMediaAsset(dataDir: string, asset: MediaAsset, maxBytes = DEFAULT_MAX_MEDIA_BYTES): Promise<Buffer> {
  if (asset.byteSize > maxBytes) throw new Error(`Media asset exceeds read limit (${asset.byteSize} bytes; limit ${maxBytes})`);
  const bytes = await readFile(getMediaAssetPath(dataDir, asset));
  if (bytes.length !== asset.byteSize) throw new Error(`Media asset size no longer matches metadata: ${asset.id}`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== asset.sha256) throw new Error(`Media asset hash no longer matches metadata: ${asset.id}`);
  return bytes;
}

export async function removeMediaAsset(input: {
  dataDir: string;
  projectId: string;
  assetId: string;
  force?: boolean;
}): Promise<{ asset: MediaAsset; detachedLinks: number }> {
  const store = new MediaStore(input.dataDir);
  const asset = store.getAsset(input.projectId, input.assetId);
  if (!asset) throw new Error(`Media asset not found: ${input.assetId}`);
  const links = store.listLinks(input.projectId, asset.id);
  if (links.length > 0 && !input.force) {
    throw new Error(`Media asset ${asset.id} is attached to ${links.length} memory record(s); rerun with --force to detach it`);
  }
  const assetPath = getMediaAssetPath(input.dataDir, asset);
  const stagedPath = deletionStagingPath(mediaRoot(input.dataDir), asset.id);
  await mkdir(path.dirname(stagedPath), { recursive: true });

  // A failed metadata transaction must not turn into data loss. Moving within
  // the media root is atomic on a single volume and makes the rollback simple.
  await rename(assetPath, stagedPath);
  let detachedLinks: number;
  try {
    ({ detachedLinks } = store.removeAssetMetadata(input.projectId, asset.id, { force: input.force }));
  } catch (error) {
    try {
      await rename(stagedPath, assetPath);
    } catch (restoreError: any) {
      const original = error instanceof Error ? error.message : String(error);
      const restore = restoreError instanceof Error ? restoreError.message : String(restoreError);
      throw new Error(`Media removal metadata update failed and the file could not be restored: ${original}; restore error: ${restore}`);
    }
    throw error;
  }

  // A locked file can be retried by a later cleanup; it is already outside the
  // active asset tree and no database row refers to it anymore.
  await rm(stagedPath, { force: true }).catch(() => {});
  return { asset, detachedLinks };
}

export async function cleanupMediaQuota(input: {
  dataDir: string;
  projectId: string;
  maxBytes?: number;
}): Promise<{ beforeBytes: number; afterBytes: number; removed: MediaAsset[] }> {
  const store = new MediaStore(input.dataDir);
  const maxBytes = input.maxBytes ?? DEFAULT_MEDIA_QUOTA_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('maxBytes must be a non-negative integer');
  const beforeBytes = store.activeByteSize(input.projectId);
  let currentBytes = beforeBytes;
  const removed: MediaAsset[] = [];
  if (currentBytes <= maxBytes) return { beforeBytes, afterBytes: currentBytes, removed };

  // Fail closed: all candidates come from the link-aware query. A query error leaves all assets intact.
  const candidates = store.listUnlinkedAssets(input.projectId);
  for (const asset of candidates) {
    if (currentBytes <= maxBytes) break;
    await removeMediaAsset({
      dataDir: input.dataDir,
      projectId: input.projectId,
      assetId: asset.id,
      force: false,
    });
    currentBytes -= asset.byteSize;
    removed.push(asset);
  }
  return { beforeBytes, afterBytes: Math.max(0, currentBytes), removed };
}
