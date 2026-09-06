import { describe, it, expect } from 'vitest';

import { compareVersion, mergeOne, nextVersion } from '../../src/sync/merge.js';
import type { ChangeEntry, RowVersion, SyncRowState } from '../../src/sync/types.js';
import type { Observation } from '../../src/types.js';

function obs(partial: Partial<Observation> & { id: number }): Observation {
  return {
    entityName: 'e', type: 'insight', title: 't', narrative: '', facts: [], filesModified: [],
    concepts: [], tokens: 0, createdAt: '2026-01-01T00:00:00.000Z', projectId: 'p', status: 'active',
    ...partial,
  } as Observation;
}

function v(revision: number, writer: string): RowVersion {
  return { revision, writer };
}

function state(partial: Partial<SyncRowState> & { syncKey: string }): SyncRowState {
  return { obsId: 1, revision: 1, writer: 'a', kind: 'upsert', contentHash: 'h', shippedSeq: 1, ...partial };
}

function upsert(syncKey: string, version: RowVersion, row: Observation): ChangeEntry {
  return { syncKey, kind: 'upsert', version, row };
}

describe('compareVersion', () => {
  it('orders by revision first', () => {
    expect(compareVersion(v(2, 'a'), v(1, 'z'))).toBeGreaterThan(0);
    expect(compareVersion(v(1, 'z'), v(2, 'a'))).toBeLessThan(0);
  });
  it('breaks ties by writer id deterministically', () => {
    expect(compareVersion(v(3, 'b'), v(3, 'a'))).toBeGreaterThan(0);
    expect(compareVersion(v(3, 'a'), v(3, 'b'))).toBeLessThan(0);
  });
  it('is zero for identical versions', () => {
    expect(compareVersion(v(3, 'a'), v(3, 'a'))).toBe(0);
  });
  it('is a total order (antisymmetric)', () => {
    const a = v(5, 'x'), b = v(4, 'y');
    expect(Math.sign(compareVersion(a, b))).toBe(-Math.sign(compareVersion(b, a)));
  });
});

describe('nextVersion', () => {
  it('advances revision from prior state', () => {
    expect(nextVersion(state({ syncKey: 'k', revision: 7 }), 'dev', 'now')).toEqual({ revision: 8, writer: 'dev', at: 'now' });
  });
  it('starts at revision 1 with no prior', () => {
    expect(nextVersion(undefined, 'dev', 'now')).toEqual({ revision: 1, writer: 'dev', at: 'now' });
  });
});

describe('mergeOne — convergent LWW', () => {
  it('inserts a brand-new remote row', () => {
    const r = mergeOne({ incoming: upsert('k', v(1, 'remote'), obs({ id: 5 })), local: undefined, incomingHash: 'h1' });
    expect(r.action).toEqual({ type: 'insert', version: v(1, 'remote'), contentHash: 'h1' });
    expect(r.decision.outcome).toBe('apply');
  });

  it('records a remote tombstone even with no local row', () => {
    const r = mergeOne({ incoming: { syncKey: 'k', kind: 'tombstone', version: v(2, 'remote') }, local: undefined, incomingHash: '' });
    expect(r.action.type).toBe('noop');
    expect(r.decision.outcome).toBe('apply'); // engine persists the tombstone
  });

  it('applies a strictly newer upsert', () => {
    const local = state({ syncKey: 'k', revision: 1, writer: 'local' });
    const r = mergeOne({ incoming: upsert('k', v(2, 'remote'), obs({ id: 1 })), local, incomingHash: 'h2' });
    expect(r.action).toEqual({ type: 'update', obsId: 1, version: v(2, 'remote'), contentHash: 'h2' });
  });

  it('skips an older upsert (local wins)', () => {
    const local = state({ syncKey: 'k', revision: 5, writer: 'local' });
    const r = mergeOne({ incoming: upsert('k', v(2, 'remote'), obs({ id: 1 })), local, incomingHash: 'h' });
    expect(r.action.type).toBe('noop');
    expect(r.decision.outcome).toBe('skip-older');
  });

  it('skips an equal version (idempotent re-pull)', () => {
    const local = state({ syncKey: 'k', revision: 3, writer: 'remote' });
    const r = mergeOne({ incoming: upsert('k', v(3, 'remote'), obs({ id: 1 })), local, incomingHash: 'h' });
    expect(r.action.type).toBe('noop');
    expect(r.decision.outcome).toBe('skip-equal');
  });

  it('newer tombstone deletes a live local row', () => {
    const local = state({ syncKey: 'k', obsId: 9, revision: 1, writer: 'local' });
    const r = mergeOne({ incoming: { syncKey: 'k', kind: 'tombstone', version: v(2, 'remote') }, local, incomingHash: '' });
    expect(r.action).toEqual({ type: 'remove', obsId: 9, version: v(2, 'remote') });
    expect(r.decision.kind).toBe('tombstone');
  });

  it('stale upsert cannot resurrect a newer local tombstone', () => {
    const local = state({ syncKey: 'k', obsId: null, revision: 5, writer: 'local', kind: 'tombstone', contentHash: '' });
    const r = mergeOne({ incoming: upsert('k', v(2, 'remote'), obs({ id: 1 })), local, incomingHash: 'h' });
    expect(r.action.type).toBe('noop');
    expect(r.decision.outcome).toBe('skip-older');
  });

  it('genuinely newer upsert revives a local tombstone via insert', () => {
    const local = state({ syncKey: 'k', obsId: null, revision: 2, writer: 'local', kind: 'tombstone', contentHash: '' });
    const r = mergeOne({ incoming: upsert('k', v(9, 'remote'), obs({ id: 1 })), local, incomingHash: 'h9' });
    expect(r.action).toEqual({ type: 'insert', version: v(9, 'remote'), contentHash: 'h9' });
  });

  it('converges regardless of order: {active-rev2, archived-rev1} → active-rev2 either way', () => {
    const activeUp = upsert('k', v(2, 'A'), obs({ id: 1, status: 'active' }));
    const archivedUp = upsert('k', v(1, 'B'), obs({ id: 1, status: 'archived' }));
    const base = state({ syncKey: 'k', revision: 0, writer: 'seed' });

    // order 1: apply archived(rev1) then active(rev2)
    let s: SyncRowState = { ...base, revision: 1, writer: 'B' }; // after archived
    const r1 = mergeOne({ incoming: activeUp, local: s, incomingHash: 'ha' });
    expect(r1.action.type).toBe('update'); // active wins (rev2 > rev1)

    // order 2: apply active(rev2) then archived(rev1)
    s = { ...base, revision: 2, writer: 'A' }; // after active
    const r2 = mergeOne({ incoming: archivedUp, local: s, incomingHash: 'hb' });
    expect(r2.action.type).toBe('noop'); // archived loses (rev1 < rev2)
    expect(r2.decision.outcome).toBe('skip-older');
    // Both orders converge to the active (rev2) row.
  });
});
