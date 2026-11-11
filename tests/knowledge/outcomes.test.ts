import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OutcomeStore } from '../../src/knowledge/outcome-store.js';
import { qualityFromOutcome } from '../../src/knowledge/outcome-types.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let dir: string | undefined;

function dataDir(): string {
  dir = mkdtempSync(path.join(tmpdir(), 'memorix-outcomes-'));
  return dir;
}

afterEach(() => {
  closeAllDatabases();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('memory outcome signals', () => {
  it('keeps an append-only latest outcome per scoped candidate', async () => {
    const store = new OutcomeStore();
    await store.init(dataDir());
    store.record({
      projectId: 'org/repo',
      candidateKind: 'durable-memory',
      candidateId: 'memory-a',
      kind: 'verification-passed',
      sourceRef: 'workflow-run:one',
      observedAt: '2026-08-01T00:00:00.000Z',
    });
    store.record({
      projectId: 'org/repo',
      candidateKind: 'durable-memory',
      candidateId: 'memory-a',
      kind: 'verification-failed',
      sourceRef: 'workflow-run:two',
      observedAt: '2026-08-02T00:00:00.000Z',
    });

    const latest = store.latestForCandidates('org/repo', 'durable-memory', ['memory-a']);
    expect(latest.get('memory-a')).toMatchObject({ kind: 'verification-failed' });
    expect(qualityFromOutcome(latest.get('memory-a'))).toBe('degraded');
  });

  it('sanitizes stored outcome detail without mutating the referenced artifact', async () => {
    const store = new OutcomeStore();
    await store.init(dataDir());
    const signal = store.record({
      projectId: 'org/repo',
      candidateKind: 'claim',
      candidateId: 'claim-a',
      kind: 'user-correction',
      sourceRef: 'review:one',
      detail: 'api_key=super-secret-value must not be retained.',
    });
    expect(signal.detail).toContain('api_key=[REDACTED]');
    expect(qualityFromOutcome(signal)).toBe('degraded');
  });
});
