/**
 * Rules Utilities
 *
 * Shared helpers for rule parsing: content hashing, ID generation, etc.
 */

import { createHash } from 'node:crypto';

/** Generate a deterministic content hash for deduplication */
export function hashContent(content: string): string {
  return createHash('sha256')
    .update(content.trim())
    .digest('hex')
    .substring(0, 16);
}

/** Generate a rule ID from source + file path */
export function generateRuleId(source: string, filePath: string): string {
  const sanitized = filePath.replace(/[\/\\]/g, '-').replace(/^\./, '');
  return `${source}:${sanitized}`;
}
