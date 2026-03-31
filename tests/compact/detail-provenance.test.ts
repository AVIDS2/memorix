/**
 * Phase 3: Detail Provenance Header Tests
 *
 * Verifies that formatObservationDetail() prepends a provenance header
 * identifying the evidence kind before the main #ID block, while keeping
 * the #ID + title structure stable and backward-compatible.
 */

import { describe, it, expect } from 'vitest';
import { formatObservationDetail } from '../../src/compact/index-format.js';

function makeDoc(overrides: Partial<Parameters<typeof formatObservationDetail>[0]> = {}) {
  return {
    observationId: 42,
    type: 'gotcha',
    title: 'Test observation',
    narrative: 'Some narrative.',
    facts: '',
    filesModified: '',
    concepts: '',
    createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    projectId: 'test/project',
    entityName: 'auth',
    ...overrides,
  };
}

// ── Provenance header content ─────────────────────────────────────────

describe('Provenance header: sourceDetail', () => {
  it('git-ingest → Git Repository Evidence + L3', () => {
    const out = formatObservationDetail(makeDoc({ sourceDetail: 'git-ingest' }));
    expect(out).toContain('Git Repository Evidence');
    expect(out).toContain('L3');
  });

  it('hook → Hook Trace + L1', () => {
    const out = formatObservationDetail(makeDoc({ sourceDetail: 'hook' }));
    expect(out).toContain('Hook Trace');
    expect(out).toContain('L1');
  });

  it('explicit → Explicit Working Memory + L2', () => {
    const out = formatObservationDetail(makeDoc({ sourceDetail: 'explicit' }));
    expect(out).toContain('Explicit Working Memory');
    expect(out).toContain('L2');
  });

  it('no sourceDetail → no provenance header (backward-compat)', () => {
    const out = formatObservationDetail(makeDoc());
    expect(out).not.toContain('Evidence');
    expect(out).not.toContain('Hook Trace');
    expect(out).not.toContain('[L');
  });

  it('empty-string sourceDetail → no provenance header (backward-compat)', () => {
    const out = formatObservationDetail(makeDoc({ sourceDetail: '' }));
    expect(out).not.toContain('[L');
  });
});

describe('Provenance header: valueCategory', () => {
  it('explicit + core → shows ★ Core', () => {
    const out = formatObservationDetail(makeDoc({ sourceDetail: 'explicit', valueCategory: 'core' }));
    expect(out).toContain('★ Core');
    expect(out).toContain('immune to decay');
  });

  it('git-ingest + core → shows ★ Core (core promotes to L2 but header still present)', () => {
    const out = formatObservationDetail(makeDoc({ sourceDetail: 'git-ingest', valueCategory: 'core' }));
    expect(out).toContain('Git Repository Evidence');
    expect(out).toContain('★ Core');
  });

  it('hook + ephemeral → shows ⚠ Ephemeral', () => {
    const out = formatObservationDetail(makeDoc({ sourceDetail: 'hook', valueCategory: 'ephemeral' }));
    expect(out).toContain('⚠ Ephemeral');
    expect(out).toContain('short-lived signal');
  });

  it('explicit + contextual → no valueCategory annotation (neutral)', () => {
    const out = formatObservationDetail(makeDoc({ sourceDetail: 'explicit', valueCategory: 'contextual' }));
    expect(out).not.toContain('★');
    expect(out).not.toContain('⚠');
  });
});

// ── #ID + title structure stability ──────────────────────────────────

describe('#ID and title structure stability', () => {
  it('#ID is always present after the provenance header', () => {
    for (const sd of ['explicit', 'hook', 'git-ingest', undefined]) {
      const out = formatObservationDetail(makeDoc({ sourceDetail: sd }));
      expect(out).toContain('#42');
    }
  });

  it('title is always present', () => {
    const out = formatObservationDetail(makeDoc({ sourceDetail: 'git-ingest', title: 'My title' }));
    expect(out).toContain('My title');
  });

  it('provenance header appears BEFORE #ID line', () => {
    const out = formatObservationDetail(makeDoc({ sourceDetail: 'hook' }));
    const headerPos = out.indexOf('Hook Trace');
    const idPos = out.indexOf('#42');
    expect(headerPos).toBeLessThan(idPos);
  });

  it('no sourceDetail → first line is #ID line', () => {
    const out = formatObservationDetail(makeDoc());
    expect(out.trimStart().startsWith('#42')).toBe(true);
  });

  it('narrative, facts, files still present after provenance header', () => {
    const out = formatObservationDetail(makeDoc({
      sourceDetail: 'explicit',
      narrative: 'Unique narrative text',
      facts: 'fact one\nfact two',
      filesModified: 'src/auth.ts',
    }));
    expect(out).toContain('Unique narrative text');
    expect(out).toContain('fact one');
    expect(out).toContain('src/auth.ts');
  });
});
