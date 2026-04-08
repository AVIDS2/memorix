/**
 * Phase 2: Layered Search Format Tests
 *
 * Verifies that formatIndexTable() shows Src badge column and tier summary
 * when entries have provenance fields, while keeping #ID/title structure stable.
 */

import { describe, it, expect } from 'vitest';
import { formatIndexTable } from '../../src/compact/index-format.js';
import type { IndexEntry } from '../../src/types.js';

function makeEntry(overrides: Partial<IndexEntry> & { id: number }): IndexEntry {
  return {
    time: '1d ago',
    type: 'gotcha',
    icon: '🔶',
    title: `Entry ${overrides.id}`,
    tokens: 100,
    score: 1.0,
    projectId: 'test/project',
    source: 'agent',
    ...overrides,
  };
}

// ── Core structure stability ─────────────────────────────────────────

describe('Core structure stability', () => {
  it('Ref column uses canonical typed refs (obs:N)', () => {
    const entries = [
      makeEntry({ id: 12, sourceDetail: 'explicit' }),
      makeEntry({ id: 34, sourceDetail: 'hook' }),
    ];
    const output = formatIndexTable(entries, 'auth');

    expect(output).toContain('obs:12');
    expect(output).toContain('obs:34');
    // IDs are in table rows as typed refs
    expect(output).toMatch(/\| obs:12 \|/);
    expect(output).toMatch(/\| obs:34 \|/);
  });

  it('title is preserved in output', () => {
    const entries = [
      makeEntry({ id: 1, title: 'JWT expiry gotcha', sourceDetail: 'explicit' }),
    ];
    const output = formatIndexTable(entries, 'auth');

    expect(output).toContain('JWT expiry gotcha');
  });

  it('token count is preserved', () => {
    const entries = [makeEntry({ id: 1, tokens: 250, sourceDetail: 'explicit' })];
    const output = formatIndexTable(entries);

    expect(output).toContain('~250');
  });

  it('empty entries returns no-result message', () => {
    expect(formatIndexTable([], 'auth')).toContain('No memories found matching');
    expect(formatIndexTable([])).toContain('No memories found');
  });
});

// ── Src badge column ─────────────────────────────────────────────────

describe('Src badge column', () => {
  it('shows Src column when entries have sourceDetail', () => {
    const entries = [
      makeEntry({ id: 1, sourceDetail: 'explicit' }),
      makeEntry({ id: 2, sourceDetail: 'hook' }),
    ];
    const output = formatIndexTable(entries);

    expect(output).toContain('| Src |');
    expect(output).toContain('| ex |');
    expect(output).toContain('| hk |');
  });

  it('shows git badge for git-ingest entries', () => {
    const entries = [makeEntry({ id: 1, sourceDetail: 'git-ingest' })];
    const output = formatIndexTable(entries);

    expect(output).toContain('| Src |');
    expect(output).toContain('| git |');
  });

  it('omits Src column when no entries have sourceDetail', () => {
    const entries = [
      makeEntry({ id: 1, sourceDetail: undefined }),
      makeEntry({ id: 2, sourceDetail: undefined }),
    ];
    const output = formatIndexTable(entries);

    expect(output).not.toContain('| Src |');
  });

  it('shows dash for entries with no sourceDetail in a mixed set', () => {
    const entries = [
      makeEntry({ id: 1, sourceDetail: 'explicit' }),
      makeEntry({ id: 2, sourceDetail: undefined }),
    ];
    const output = formatIndexTable(entries);

    expect(output).toContain('| Src |');
    // The entry without sourceDetail should show '-'
    const rows = output.split('\n').filter((l) => l.includes('| obs:'));
    expect(rows.some((r) => r.includes('| - |'))).toBe(true);
  });
});

// ── Tier summary ─────────────────────────────────────────────────────

describe('Tier summary line', () => {
  it('shows tier summary for mixed explicit + hook entries', () => {
    const entries = [
      makeEntry({ id: 1, sourceDetail: 'explicit' }),
      makeEntry({ id: 2, sourceDetail: 'hook' }),
    ];
    const output = formatIndexTable(entries);

    expect(output).toContain('Sources:');
    expect(output).toContain('explicit');
    expect(output).toContain('hook');
  });

  it('shows tier summary for explicit + git-ingest mix', () => {
    const entries = [
      makeEntry({ id: 1, sourceDetail: 'explicit' }),
      makeEntry({ id: 2, sourceDetail: 'git-ingest' }),
    ];
    const output = formatIndexTable(entries);

    expect(output).toContain('Sources:');
    expect(output).toContain('git');
  });

  it('suppresses tier summary when all entries have the same badge', () => {
    const entries = [
      makeEntry({ id: 1, sourceDetail: 'explicit' }),
      makeEntry({ id: 2, sourceDetail: 'explicit' }),
      makeEntry({ id: 3, sourceDetail: 'explicit' }),
    ];
    const output = formatIndexTable(entries);

    expect(output).not.toContain('Sources:');
  });

  it('suppresses tier summary when all entries have no sourceDetail', () => {
    const entries = [
      makeEntry({ id: 1 }),
      makeEntry({ id: 2 }),
    ];
    const output = formatIndexTable(entries);

    expect(output).not.toContain('Sources:');
  });

  it('shows tier summary when sourceDetail is mixed with missing', () => {
    const entries = [
      makeEntry({ id: 1, sourceDetail: 'explicit' }),
      makeEntry({ id: 2, sourceDetail: undefined }),
    ];
    const output = formatIndexTable(entries);

    // Mixed: one has badge, one does not → summary shown
    expect(output).toContain('Sources:');
    expect(output).toContain('legacy');
  });
});

// ── Progressive disclosure hint preserved ───────────────────────────

describe('Progressive disclosure hint', () => {
  it('still shows disclosure hint regardless of badge column presence', () => {
    const entries = [makeEntry({ id: 1, sourceDetail: 'explicit' })];
    const output = formatIndexTable(entries);

    expect(output).toContain('Progressive Disclosure');
    expect(output).toContain('memorix_detail');
  });
});
