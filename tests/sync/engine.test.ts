import { describe, it, expect } from 'vitest';

import { runSync, type SyncStorePort } from '../../src/sync/engine.js';
import type { Observation } from '../../src/types.js';
import type { ChangeBatch, SyncCursor, SyncRemote, SyncRowState } from '../../src/sync/types.js';
import { emptyCursor } from '../../src/sync/types.js';

function obs(partial: Partial<Observation> & { id: number }): Observation {
  return {
    entityName: 'e', type: 'insight', title: 't', narrative: '', facts: [], filesModified: [],
    concepts: [], tokens: 0, createdAt: '2026-01-01T00:00:00.000Z', projectId: 'p', status: 'active',
    ...partial,
  } as Observation;
}

/** In-memory store implementing the engine's port. */
class FakeStore implements SyncStorePort {
  rows = new Map<number, Observation>();
  state = new Map<string, SyncRowState>();
  seq = 0;
  idCounter = 1000;
  constructor(private readonly dev: string, initial: Observation[] = []) {
    for (const o of initial) this.rows.set(o.id, o);
  }
  deviceId() { return this.dev; }
  async loadAll() { return [...this.rows.values()]; }
  async loadState() { return new Map(this.state); }
  async saveState(rows: SyncRowState[]) { for (const r of rows) this.state.set(r.syncKey, { ...r }); }
  async allocateId() { return this.idCounter++; }
  async applyInsert(row: Observation) { this.rows.set(row.id, row); }
  async applyUpdate(row: Observation) { this.rows.set(row.id, row); }
  async applyRemove(id: number) { this.rows.delete(id); }
  async nextSequence() { return ++this.seq; }
  find(title: string) { return [...this.rows.values()].find((r) => r.title === title); }
}

/** Shared in-memory remote both stores sync against. */
class FakeRemote implements SyncRemote {
  readonly kind = 'fake';
  batches: ChangeBatch[] = [];
  cursors = new Map<string, SyncCursor>();
  async init() {}
  async getCursor(deviceId: string) { return this.cursors.get(deviceId) ?? emptyCursor(); }
  async setCursor(deviceId: string, cursor: SyncCursor) { this.cursors.set(deviceId, { applied: { ...cursor.applied } }); }
  async push(batch: ChangeBatch) {
    if (this.batches.some((b) => b.deviceId === batch.deviceId && b.sequence === batch.sequence)) return;
    this.batches.push(JSON.parse(JSON.stringify(batch)));
  }
  async pull(since: Record<string, number>) {
    return this.batches
      .filter((b) => b.sequence > (since[b.deviceId] ?? 0))
      .sort((a, b) => (a.deviceId === b.deviceId ? a.sequence - b.sequence : a.deviceId < b.deviceId ? -1 : 1))
      .map((b) => JSON.parse(JSON.stringify(b)) as ChangeBatch);
  }
  async close() {}
}

const both = { push: true, pull: true, dryRun: false };

describe('runSync end-to-end', () => {
  it('replicates a new observation from A to B (independent local ids)', async () => {
    const remote = new FakeRemote();
    const A = new FakeStore('A', [obs({ id: 1, title: 'hello', updatedAt: '2026-02-01T00:00:00.000Z' })]);
    const B = new FakeStore('B');
    await runSync(A, remote, { deviceId: 'A', ...both });
    const rep = await runSync(B, remote, { deviceId: 'B', ...both });
    const copy = B.find('hello');
    expect(copy).toBeDefined();
    expect(copy!.id).toBeGreaterThanOrEqual(1000); // B allocated its own local id
    expect(rep.applied).toBe(1);
  });

  it('does not re-apply or re-ship its own writes', async () => {
    const remote = new FakeRemote();
    const A = new FakeStore('A', [obs({ id: 1, title: 'x' })]);
    await runSync(A, remote, { deviceId: 'A', ...both });
    const rep = await runSync(A, remote, { deviceId: 'A', ...both });
    expect(rep.applied).toBe(0);
    expect(rep.pushed).toBe(0);
  });

  it('converges a concurrent topic-key edit by last-writer-wins', async () => {
    const remote = new FakeRemote();
    const A = new FakeStore('A', [obs({ id: 1, topicKey: 'auth', title: 'A-old' })]);
    const B = new FakeStore('B', [obs({ id: 7, topicKey: 'auth', title: 'B-first' })]);

    await runSync(A, remote, { deviceId: 'A', ...both }); // A ships rev1
    await runSync(B, remote, { deviceId: 'B', ...both }); // B pulls A(rev1)->applies, then would ship
    // B now edits the shared topic to a newer revision
    const bRow = B.find('A-old') ?? B.find('B-first')!;
    B.rows.set(bRow.id, { ...bRow, title: 'B-new' });
    await runSync(B, remote, { deviceId: 'B', ...both }); // B ships rev2
    await runSync(A, remote, { deviceId: 'A', ...both }); // A pulls B(rev2)

    expect(A.find('B-new')).toBeDefined();
    expect(A.find('A-old')).toBeUndefined();
  });

  it('propagates a delete as a durable tombstone', async () => {
    const remote = new FakeRemote();
    const A = new FakeStore('A', [obs({ id: 1, topicKey: 't', title: 'doomed' })]);
    const B = new FakeStore('B');
    await runSync(A, remote, { deviceId: 'A', ...both });
    await runSync(B, remote, { deviceId: 'B', ...both });
    expect(B.find('doomed')).toBeDefined();

    // delete on A
    A.rows.clear();
    await runSync(A, remote, { deviceId: 'A', ...both });
    const rep = await runSync(B, remote, { deviceId: 'B', ...both });
    expect(B.find('doomed')).toBeUndefined();
    expect(rep.tombstoned).toBe(1);
  });

  it('a stale upsert re-pulled later cannot resurrect a deleted row', async () => {
    const remote = new FakeRemote();
    const A = new FakeStore('A', [obs({ id: 1, topicKey: 't', title: 'v1' })]);
    const B = new FakeStore('B');
    await runSync(A, remote, { deviceId: 'A', ...both }); // A ships upsert rev1
    await runSync(A, remote, { deviceId: 'A', push: false, pull: true, dryRun: false });

    // A deletes and ships a tombstone (rev2)
    A.rows.clear();
    await runSync(A, remote, { deviceId: 'A', ...both });

    // B pulls both batches (upsert rev1 then tombstone rev2) in one go
    await runSync(B, remote, { deviceId: 'B', ...both });
    expect(B.find('v1')).toBeUndefined();

    // Re-pull is idempotent — the recorded tombstone still wins.
    await runSync(B, remote, { deviceId: 'B', ...both });
    expect(B.find('v1')).toBeUndefined();
  });

  it('dry run reports decisions without mutating', async () => {
    const remote = new FakeRemote();
    const A = new FakeStore('A', [obs({ id: 1, title: 'y' })]);
    await runSync(A, remote, { deviceId: 'A', ...both });
    const B = new FakeStore('B');
    const rep = await runSync(B, remote, { deviceId: 'B', push: true, pull: true, dryRun: true });
    expect(rep.decisions.length).toBeGreaterThan(0);
    expect(B.rows.size).toBe(0);
    expect(B.state.size).toBe(0);
  });
});
