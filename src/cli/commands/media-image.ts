import { readFile, stat } from 'node:fs/promises';

import { MAX_VISION_IMAGE_BYTES } from '../../multimodal/image-payload.js';

function matchesImagePrefix(bytes: Buffer, prefix: number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function detectReferenceImageMimeType(bytes: Buffer): string | undefined {
  if (bytes.length >= 8 && matchesImagePrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (bytes.length >= 3 && matchesImagePrefix(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a')) return 'image/gif';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return undefined;
}

export async function readSubjectImage(filePath: string): Promise<{ data: string; mimeType: string }> {
  const fileStats = await stat(filePath);
  if (fileStats.size > MAX_VISION_IMAGE_BYTES) {
    throw new Error(`Reference image exceeds the ${MAX_VISION_IMAGE_BYTES}-byte visual analysis limit`);
  }
  const bytes = await readFile(filePath);
  if (bytes.length === 0) throw new Error(`Reference image is empty: ${filePath}`);
  const mimeType = detectReferenceImageMimeType(bytes);
  if (!mimeType) throw new Error('Reference image must be a PNG, JPEG, GIF, or WebP file');
  return { data: bytes.toString('base64'), mimeType };
}
