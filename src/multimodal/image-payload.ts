import { Buffer } from 'node:buffer';

/** Keep visual-analysis requests bounded even when controlled assets allow larger files. */
export const MAX_VISION_IMAGE_BYTES = 20 * 1024 * 1024;

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

function isBase64Character(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a)
    || (code >= 0x61 && code <= 0x7a)
    || (code >= 0x30 && code <= 0x39)
    || code === 0x2b
    || code === 0x2f
  );
}

/**
 * Decode only canonical standard base64. This is deliberately separate from
 * MIME detection in the controlled asset store, which remains authoritative.
 */
export function decodeBase64ImagePayload(
  value: string,
  maxBytes = MAX_VISION_IMAGE_BYTES,
): Buffer {
  const raw = value.trim();
  if (!raw) throw new Error('base64 image data is required');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('image payload limit must be a positive integer');
  }

  const maximumLength = Math.ceil(maxBytes / 3) * 4;
  if (raw.length > maximumLength) {
    throw new Error(`base64 image data exceeds the ${maxBytes}-byte visual analysis limit`);
  }
  if (raw.length % 4 !== 0) throw new Error('base64 image data is invalid');

  let padding = 0;
  let sawPadding = false;
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    if (code === 0x3d) {
      sawPadding = true;
      padding += 1;
      continue;
    }
    if (sawPadding || !isBase64Character(code)) throw new Error('base64 image data is invalid');
  }
  if (padding > 2) throw new Error('base64 image data is invalid');

  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length === 0 || bytes.length > maxBytes || bytes.toString('base64') !== raw) {
    throw new Error('base64 image data is invalid or exceeds the visual analysis limit');
  }
  return bytes;
}

export function normalizeVisionImageMimeType(value: string | undefined): string {
  const mimeType = (value ?? 'image/png').trim().toLowerCase();
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported image MIME type for visual analysis: ${mimeType || '(empty)'}`);
  }
  return mimeType;
}
