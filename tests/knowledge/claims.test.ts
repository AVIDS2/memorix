import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveLowRiskClaimsFromObservation, requalifyClaimsForCodeState, selectClaimsForTask, supersedeClaim, writeClaim } from '../../src/knowledge/claims.js';
import { ClaimStore } from '../../src/knowledge/claim-store.js';
import { CodeGraphStore } from '../../src/codegraph/store.js';
import type { Observation } from '../../src/types.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let dataDir: string | null = null;

function tempDir(): string {
  dataDir = mkdtempSync(join(tmpdir(), 'memorix-claims-'));
  return dataDir;
}

function evidence(id: string, overrides: Record<string, unknown> = {}) {
  return {
    evidenceKind: 'observation' as const,
    evidenceId: id,
    relation: 'supports' as const,
    locator: 'observation/' + id,
    capturedHash: 'hash-' + id,
    ...overrides,
  };
}

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: 42,
    entityName: 'auth',
    type: 'decision',
    title: 'Use signed session cookies',
    narrative: 'The authentication middleware uses signed session cookies.',
    facts: [],
    filesModified: ['src/auth.ts'],
    concepts: [],
    tokens: 20,
    createdAt: '2026-07-17T00:00:00.000Z',
    projectId: 'org/repo',
    status: 'active',
    source: 'manual',
    sourceDetail: 'explicit',
    ...overrides,
  };
}

async function newClaimStore(): Promise<ClaimStore> {
  const store = new ClaimStore();
  await store.init(tempDir());
  return store;
}

afterEach(() => {
  closeAllDatabases();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = null;
});

describe('knowledge claim ledger', () => {
  it('requires source evidence, normalizes an exact claim identity, and keeps credentials out of durable fields', async () => {
    const store = await newClaimStore();

    expect(() => writeClaim(store, {
      projectId: 'org/repo',
      subject: 'auth',
      predicate: 'uses',
      objectValue: 'signed cookies',
      scope: 'project',
      evidence: [],
    })).toThrow(/evidence/i);

    const first = writeClaim(store, {
      projectId: 'org/repo',
      subject: ' Auth  ',
      predicate: 'USES',
      objectValue: 'signed cookies',
      scope: 'project',
      evidence: [evidence('42')],
    });
    const same = writeClaim(store, {
      projectId: 'org/repo',
      subject: 'auth',
      predicate: 'uses',
      objectValue: 'signed   cookies',
      scope: 'project',
      evidence: [evidence('43')],
    });
    const redacted = writeClaim(store, {
      projectId: 'org/repo',
      subject: 'deployment',
      predicate: 'uses',
      objectValue: 'api_key=sk-abcdefghijklmnopqrstuvwxy',
      scope: 'project',
      evidence: [evidence('secret', { locator: 'config?api_key=abcdefghijklmnopqrstuvwxy' })],
    });

    expect(first.created).toBe(true);
    expect(same.created).toBe(false);
    expect(same.claim.id).toBe(first.claim.id);
    expect(store.listEvidence(first.claim.id)).toHaveLength(2);
    expect(redacted.claim.objectValue).toContain('[REDACTED]');
    expect(store.listEvidence(redacted.claim.id)[0].locator).toContain('[REDACTED]');
  });

  it('preserves conflicting active claims and only supersedes through an evidence-aware transition', async () => {
    const store = await newClaimStore();
    const older = writeClaim(store, {
      projectId: 'org/repo',
      subject: 'auth',
      predicate: 'uses',
      objectValue: 'signed cookies',
      scope: 'project',
      evidence: [evidence('older')],
    });
    const newer = writeClaim(store, {
      projectId: 'org/repo',
      subject: 'auth',
      predicate: 'uses',
      objectValue: 'JWT bearer tokens',
      scope: 'project',
      evidence: [evidence('newer')],
    });

    expect(store.getClaim(older.claim.id)).toMatchObject({ status: 'disputed' });
    expect(store.getClaim(newer.claim.id)).toMatchObject({ status: 'disputed' });
    expect(store.listConflicts('org/repo')).toEqual([
      expect.objectContaining({
        conflictKey: older.claim.conflictKey,
        claims: expect.arrayContaining([
          expect.objectContaining({ id: older.claim.id }),
          expect.objectContaining({ id: newer.claim.id }),
        ]),
      }),
    ]);

    expect(() => supersedeClaim(store, {
      claimId: older.claim.id,
      replacementClaimId: newer.claim.id,
      evidence: [],
    })).toThrow(/evidence/i);

    const transition = supersedeClaim(store, {
      claimId: older.claim.id,
      replacementClaimId: newer.claim.id,
      evidence: [evidence('migration-commit', { evidenceKind: 'git', locator: 'git:abc123' })],
    });

    expect(transition.superseded.id).toBe(older.claim.id);
    expect(store.getClaim(older.claim.id)).toMatchObject({
      status: 'superseded',
      supersededBy: newer.claim.id,
    });
    expect(store.getClaim(newer.claim.id)).toMatchObject({ status: 'active' });
    expect(store.listEvents(older.claim.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'superseded', relatedClaimId: newer.claim.id })]),
    );
  });

  it('keeps model-origin claims in review even when a caller asks to approve them', async () => {
    const store = await newClaimStore();

    expect(() => writeClaim(store, {
      projectId: 'org/repo',
      subject: 'auth',
      predicate: 'uses',
      objectValue: 'unverified model statement',
      scope: 'project',
      origin: 'model',
      reviewState: 'approved',
      evidence: [evidence('model-1')],
    })).toThrow(/model-origin/i);

    const draft = writeClaim(store, {
      projectId: 'org/repo',
      subject: 'auth',
      predicate: 'uses',
      objectValue: 'unverified model statement',
      scope: 'project',
      origin: 'model',
      evidence: [evidence('model-1')],
    });

    expect(draft.claim).toMatchObject({ reviewState: 'draft', status: 'unknown' });
  });

  it('derives conservative claims from explicit observations and requalifies them when bound code disappears or the scan is incomplete', async () => {
    const store = await newClaimStore();
    const code = new CodeGraphStore();
    await code.init(dataDir!);
    code.upsertFiles([{
      id: 'file:auth',
      projectId: 'org/repo',
      path: 'src/auth.ts',
      contentHash: 'file-v1',
      indexedAt: '2026-07-17T00:00:00.000Z',
    }]);
    code.upsertSymbols([{
      id: 'symbol:auth',
      projectId: 'org/repo',
      fileId: 'file:auth',
      path: 'src/auth.ts',
      name: 'createSession',
      qualifiedName: 'createSession',
      kind: 'function',
      contentHash: 'symbol-v1',
      indexedAt: '2026-07-17T00:00:00.000Z',
    }]);
    code.upsertObservationRefs([{
      id: 'ref:auth',
      projectId: 'org/repo',
      observationId: 42,
      fileId: 'file:auth',
      symbolId: 'symbol:auth',
      capturedFileHash: 'file-v1',
      capturedSymbolHash: 'symbol-v1',
      status: 'current',
      createdAt: '2026-07-17T00:00:00.000Z',
    }]);
    code.recordCodeStateSnapshot({
      projectId: 'org/repo',
      provider: 'lite',
      baseRevision: 'a'.repeat(40),
      worktreeFingerprint: 'b'.repeat(64),
      worktreeState: 'clean',
      changedPathCount: 0,
      indexedAt: '2026-07-17T00:00:00.000Z',
      completeness: {
        scannedFiles: 1,
        maxFiles: 5_000,
        changedFiles: 1,
        unchangedFiles: 0,
        metadataOnlyFiles: 0,
        removedFiles: 0,
        skippedOversizedFiles: 0,
        removalScanDeferred: false,
      },
    });

    const derived = deriveLowRiskClaimsFromObservation(store, observation(), code);
    expect(derived).toHaveLength(1);
    expect(store.listEvidence(derived[0].id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidenceKind: 'observation', evidenceId: 'observation:42' }),
      expect.objectContaining({ evidenceKind: 'code', evidenceId: 'code-ref:ref:auth' }),
    ]));

    code.applyFileDeltas('org/repo', { changed: [], removedFileIds: ['file:auth'] });
    const missing = requalifyClaimsForCodeState(store, code, 'org/repo');
    expect(missing.requalified).toBe(1);
    expect(store.getClaim(derived[0].id)).toMatchObject({
      status: 'unknown',
      reviewState: 'needs-review',
      confidence: expect.any(Number),
    });

    code.upsertFiles([{
      id: 'file:build',
      projectId: 'org/repo',
      path: 'src/build.ts',
      contentHash: 'build-v1',
      indexedAt: '2026-07-17T00:01:00.000Z',
    }]);
    code.upsertSymbols([{
      id: 'symbol:build',
      projectId: 'org/repo',
      fileId: 'file:build',
      path: 'src/build.ts',
      name: 'buildIndex',
      qualifiedName: 'buildIndex',
      kind: 'function',
      contentHash: 'build-symbol-v1',
      indexedAt: '2026-07-17T00:01:00.000Z',
    }]);
    code.upsertObservationRefs([{
      id: 'ref:build',
      projectId: 'org/repo',
      observationId: 99,
      fileId: 'file:build',
      symbolId: 'symbol:build',
      capturedFileHash: 'build-v1',
      capturedSymbolHash: 'build-symbol-v1',
      status: 'current',
      createdAt: '2026-07-17T00:01:00.000Z',
    }]);
    code.recordCodeStateSnapshot({
      projectId: 'org/repo',
      provider: 'lite',
      baseRevision: 'b'.repeat(40),
      worktreeFingerprint: 'c'.repeat(64),
      worktreeState: 'clean',
      changedPathCount: 0,
      indexedAt: '2026-07-17T00:01:00.000Z',
      completeness: {
        scannedFiles: 1,
        maxFiles: 5_000,
        changedFiles: 1,
        unchangedFiles: 0,
        metadataOnlyFiles: 0,
        removedFiles: 0,
        skippedOversizedFiles: 0,
        removalScanDeferred: false,
      },
    });
    const codeBound = deriveLowRiskClaimsFromObservation(store, observation({
      id: 99,
      entityName: 'build',
      title: 'Build uses incremental index',
      narrative: 'The build pipeline uses the incremental index in src/build.ts.',
      filesModified: ['src/build.ts'],
    }), code);
    code.recordCodeStateSnapshot({
      projectId: 'org/repo',
      provider: 'lite',
      baseRevision: 'c'.repeat(40),
      worktreeFingerprint: 'd'.repeat(64),
      worktreeState: 'dirty',
      changedPathCount: 1,
      indexedAt: '2026-07-17T00:01:00.000Z',
      completeness: {
        scannedFiles: 1,
        maxFiles: 5_000,
        changedFiles: 1,
        unchangedFiles: 0,
        metadataOnlyFiles: 0,
        removedFiles: 0,
        skippedOversizedFiles: 1,
        removalScanDeferred: false,
      },
    });
    const incomplete = requalifyClaimsForCodeState(store, code, 'org/repo');
    expect(incomplete.incompleteSnapshot).toBe(true);
    expect(store.getClaim(codeBound[0].id)).toMatchObject({
      status: 'active',
      reviewState: 'needs-review',
      confidence: expect.any(Number),
    });
    expect(store.getClaim(codeBound[0].id)!.confidence).toBeLessThanOrEqual(0.55);
  });

  it('returns a compact, task-lensed selection and carries matching conflicts as a caution instead of hiding one side', async () => {
    const store = await newClaimStore();
    writeClaim(store, {
      projectId: 'org/repo',
      subject: 'auth middleware',
      predicate: 'uses',
      objectValue: 'signed cookies',
      scope: 'project',
      evidence: [evidence('auth-1')],
    });
    writeClaim(store, {
      projectId: 'org/repo',
      subject: 'auth middleware',
      predicate: 'uses',
      objectValue: 'JWT bearer tokens',
      scope: 'project',
      evidence: [evidence('auth-2')],
    });
    writeClaim(store, {
      projectId: 'org/repo',
      subject: 'release',
      predicate: 'requires',
      objectValue: 'package smoke test',
      scope: 'workflow',
      evidence: [evidence('release-1')],
    });

    const selected = selectClaimsForTask(store, {
      projectId: 'org/repo',
      task: 'Fix the auth middleware session handling.',
      limit: 3,
      maxTokens: 120,
    });

    expect(selected.claims).toHaveLength(2);
    expect(selected.claims.map(claim => claim.subject)).toEqual(['auth middleware', 'auth middleware']);
    expect(selected.cautions).toContain('claim-conflict');
    expect(selected.tokenCount).toBeLessThanOrEqual(120);
  });
});
