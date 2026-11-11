import { describe, expect, it } from 'vitest';
import {
  embeddingHealthReceipt,
  sanitizeDerivedViewFailureReason,
} from '../../src/search/derived-view-receipt.js';

describe('derived-view receipt helpers', () => {
  it('reports a degraded embedding view with a bounded operator reason', () => {
    expect(embeddingHealthReceipt({
      status: 'degraded',
      failure: {
        kind: 'authorization',
        occurredAt: '2026-10-25T10:00:00.000Z',
        retryAfterMs: 500,
      },
    }, false)).toEqual({
      freshness: 'stale',
      rebuildStatus: 'failed',
      failureReason: 'embedding authorization; retry in 500ms',
    });
  });

  it('distinguishes disabled, initialized, and uninitialized embedding views', () => {
    expect(embeddingHealthReceipt({ status: 'disabled' }, false)).toMatchObject({
      freshness: 'current', rebuildStatus: 'disabled',
    });
    expect(embeddingHealthReceipt({
      status: 'ready', provider: { name: 'api-test', dimensions: 3 },
    }, true)).toMatchObject({ freshness: 'current', rebuildStatus: 'idle' });
    expect(embeddingHealthReceipt(undefined, false)).toMatchObject({
      freshness: 'unknown', rebuildStatus: 'unavailable',
    });
  });

  it('redacts credentials and local filesystem paths from failure reasons', () => {
    const reason = sanitizeDerivedViewFailureReason(
      'failed reading C:\\Users\\Ada\\memorix\\index.db; api_key=sk-secretvalue123456',
    );

    expect(reason).not.toContain('C:\\Users\\Ada');
    expect(reason).not.toContain('sk-secretvalue123456');
    expect(reason).toContain('[path]');
    expect(reason).toContain('[REDACTED]');
    expect(sanitizeDerivedViewFailureReason('x'.repeat(500))).toHaveLength(240);
  });
});
