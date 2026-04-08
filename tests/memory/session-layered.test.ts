/**
 * Phase 2: Layered Session Context Tests
 *
 * Verifies that getSessionContext() produces explicit L1/L2/L3 sections
 * based on sourceDetail and valueCategory provenance fields.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: async () => null,
  isVectorSearchAvailable: async () => false,
  isEmbeddingExplicitlyDisabled: () => true,
  resetProvider: () => {},
}));

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { storeObservation, initObservations } from '../../src/memory/observations.js';
import { resetDb } from '../../src/store/orama-store.js';
import { getSessionContext } from '../../src/memory/session.js';
import { initObservationStore, resetObservationStore } from '../../src/store/obs-store.js';
import { initSessionStore, resetSessionStore } from '../../src/store/session-store.js';

const PROJECT_ID = 'test/session-layered';

let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-session-layered-'));
  resetObservationStore();
  resetSessionStore();
  await resetDb();
  await initObservationStore(testDir);
  await initSessionStore(testDir);
  await initObservations(testDir);
});

// ── L2: only explicit obs → no L1/L3 sections ───────────────────────

describe('L2-only project (all explicit)', () => {
  it('shows Key Project Memories but no L1 Routing or L3 Evidence sections', async () => {
    await storeObservation({
      entityName: 'auth',
      type: 'gotcha',
      title: 'JWT tokens expire silently in production',
      narrative: 'Critical gotcha about silent expiry.',
      projectId: PROJECT_ID,
      sourceDetail: 'explicit',
    });

    const ctx = await getSessionContext(testDir, PROJECT_ID);

    expect(ctx).toContain('## Key Project Memories');
    expect(ctx).toContain('JWT tokens expire silently');
    expect(ctx).not.toContain('## L1 Routing');
    expect(ctx).not.toContain('## L3 Evidence');
  });

  it('old observations without sourceDetail enter L2 (backward-compat)', async () => {
    await storeObservation({
      entityName: 'db',
      type: 'decision',
      title: 'Use PostgreSQL for primary store',
      narrative: 'Legacy decision without provenance fields.',
      projectId: PROJECT_ID,
    });

    const ctx = await getSessionContext(testDir, PROJECT_ID);

    expect(ctx).toContain('## Key Project Memories');
    expect(ctx).toContain('Use PostgreSQL for primary store');
    expect(ctx).not.toContain('## L1 Routing');
  });
});

// ── L1: hook obs → L1 section with titles + routing guidance ────────

describe('Hook observations → L1 section', () => {
  it('shows L1 Routing section with hook title when hook obs exists', async () => {
    await storeObservation({
      entityName: 'file-edit',
      type: 'what-changed',
      title: 'Edited auth/handler.ts',
      narrative: 'Hook-captured file modification.',
      projectId: PROJECT_ID,
      sourceDetail: 'hook',
    });

    const ctx = await getSessionContext(testDir, PROJECT_ID);

    expect(ctx).toContain('## L1 Routing');
    expect(ctx).toContain('Edited auth/handler.ts');
  });

  it('L1 section includes routing guidance hints', async () => {
    await storeObservation({
      entityName: 'file-edit',
      type: 'what-changed',
      title: 'Edited parser.ts',
      narrative: 'Hook auto-capture.',
      projectId: PROJECT_ID,
      sourceDetail: 'hook',
    });

    const ctx = await getSessionContext(testDir, PROJECT_ID);

    expect(ctx).toContain('## L1 Routing');
    expect(ctx).toContain('memorix_timeline');
  });

  it('hook observations do NOT appear in Key Project Memories (L2 excluded)', async () => {
    await storeObservation({
      entityName: 'hook-event',
      type: 'gotcha',
      title: 'Hook-captured gotcha that should stay in L1',
      narrative: 'This should not pollute working context.',
      projectId: PROJECT_ID,
      sourceDetail: 'hook',
    });

    const ctx = await getSessionContext(testDir, PROJECT_ID);

    // Should not be in Key Memories (L2 is source-filtered)
    if (ctx.includes('## Key Project Memories')) {
      // If the section exists, the hook obs must not be in it
      const keyMemSection = ctx.split('## L3 Evidence')[0].split('## Key Project Memories')[1] ?? '';
      expect(keyMemSection).not.toContain('Hook-captured gotcha');
    }
  });

  it('core-valued hook observations ARE promoted to L2', async () => {
    await storeObservation({
      entityName: 'arch',
      type: 'gotcha',
      title: 'Critical core gotcha from hook',
      narrative: 'Formation classified this as core.',
      projectId: PROJECT_ID,
      sourceDetail: 'hook',
      valueCategory: 'core',
    });

    const ctx = await getSessionContext(testDir, PROJECT_ID);

    // core overrides the hook L1 classification
    expect(ctx).toContain('## Key Project Memories');
    expect(ctx).toContain('Critical core gotcha from hook');
  });
});

// ── L3: git-ingest → L3 Evidence pointer (not full content) ─────────

describe('Git-ingest observations → L3 Evidence hints', () => {
  it('shows L3 Evidence section with git pointer when git obs exists', async () => {
    await storeObservation({
      entityName: 'commit-abc',
      type: 'what-changed',
      title: 'Fix null pointer in parser (commit abc1234)',
      narrative: 'Git-backed commit fact.',
      projectId: PROJECT_ID,
      source: 'git',
      sourceDetail: 'git-ingest',
    });

    const ctx = await getSessionContext(testDir, PROJECT_ID);

    expect(ctx).toContain('## L3 Evidence');
    expect(ctx).toContain('memorix_search');
  });

  it('git-ingest content does NOT appear in Key Project Memories body', async () => {
    await storeObservation({
      entityName: 'commit-abc',
      type: 'what-changed',
      title: 'Refactor storage layer in commit abc',
      narrative: 'Git-backed commit fact — should stay in L3.',
      projectId: PROJECT_ID,
      source: 'git',
      sourceDetail: 'git-ingest',
    });

    const ctx = await getSessionContext(testDir, PROJECT_ID);

    if (ctx.includes('## Key Project Memories')) {
      const keyMemSection = ctx.split('## L3 Evidence')[0].split('## Key Project Memories')[1] ?? '';
      expect(keyMemSection).not.toContain('Refactor storage layer');
    }
  });

  it('L1 Routing shows git-memory search hint when git obs exists', async () => {
    await storeObservation({
      entityName: 'commit-xyz',
      type: 'what-changed',
      title: 'Add caching layer commit xyz',
      narrative: 'Git fact.',
      projectId: PROJECT_ID,
      sourceDetail: 'git-ingest',
    });

    const ctx = await getSessionContext(testDir, PROJECT_ID);

    expect(ctx).toContain('## L1 Routing');
    expect(ctx).toContain('git-memory');
    expect(ctx).toContain('what-changed');
  });

  it('core-valued git obs are promoted to L2', async () => {
    await storeObservation({
      entityName: 'arch',
      type: 'decision',
      title: 'Core architecture commit: adopt microservices',
      narrative: 'Formation classified this git fact as core.',
      projectId: PROJECT_ID,
      sourceDetail: 'git-ingest',
      valueCategory: 'core',
    });

    const ctx = await getSessionContext(testDir, PROJECT_ID);

    expect(ctx).toContain('## Key Project Memories');
    expect(ctx).toContain('Core architecture commit: adopt microservices');
  });
});

// ── Mixed: all three layers present ──────────────────────────────────

describe('Mixed provenance project', () => {
  it('produces L1 + L2 + L3 sections in correct order', async () => {
    // L2 explicit
    await storeObservation({
      entityName: 'auth',
      type: 'gotcha',
      title: 'JWT expiry is silent',
      narrative: 'Explicit working context.',
      projectId: PROJECT_ID,
      sourceDetail: 'explicit',
    });

    // L1 hook
    await storeObservation({
      entityName: 'edit',
      type: 'what-changed',
      title: 'Edited auth.ts',
      narrative: 'Hook capture.',
      projectId: PROJECT_ID,
      sourceDetail: 'hook',
    });

    // L3 git
    await storeObservation({
      entityName: 'commit',
      type: 'what-changed',
      title: 'Fix auth bug in commit deadbeef',
      narrative: 'Git fact.',
      projectId: PROJECT_ID,
      sourceDetail: 'git-ingest',
    });

    const ctx = await getSessionContext(testDir, PROJECT_ID);

    expect(ctx).toContain('## L1 Routing');
    expect(ctx).toContain('## Key Project Memories');
    expect(ctx).toContain('## L3 Evidence');

    // Section order: L1 before Key Memories before L3
    const l1Pos = ctx.indexOf('## L1 Routing');
    const l2Pos = ctx.indexOf('## Key Project Memories');
    const l3Pos = ctx.indexOf('## L3 Evidence');
    expect(l1Pos).toBeLessThan(l2Pos);
    expect(l2Pos).toBeLessThan(l3Pos);
  });
});
