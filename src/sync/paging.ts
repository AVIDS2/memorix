/**
 * Stable keyset cursors for append-only relay logs.
 *
 * An integer offset is not safe while another device appends a batch between
 * two pages: a new key can move the offset and make an event disappear. The
 * adapters use the last `(deviceId, sequence)` they returned instead.
 */

export interface SyncPageCursor {
  deviceId: string;
  sequence: number;
}

export function encodePageCursor(cursor: SyncPageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodePageCursor(token: string | undefined): SyncPageCursor | undefined {
  if (token === undefined) return undefined;
  try {
    const value = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as Partial<SyncPageCursor>;
    const sequence = value.sequence;
    if (
      typeof value.deviceId !== 'string'
      || value.deviceId.length === 0
      || typeof sequence !== 'number'
      || !Number.isSafeInteger(sequence)
      || sequence < 1
    ) {
      throw new Error('invalid cursor fields');
    }
    return { deviceId: value.deviceId, sequence };
  } catch {
    throw new Error('[memorix] sync page token is invalid');
  }
}

export function comparePageKey(
  left: Pick<SyncPageCursor, 'deviceId' | 'sequence'>,
  right: Pick<SyncPageCursor, 'deviceId' | 'sequence'>,
): number {
  if (left.deviceId < right.deviceId) return -1;
  if (left.deviceId > right.deviceId) return 1;
  return left.sequence - right.sequence;
}
