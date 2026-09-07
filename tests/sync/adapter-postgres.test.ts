import { describe, expect, it } from 'vitest';
import { PostgresSyncRemote, type SqlClient } from '../../src/sync/adapters/postgres.js';
import type { ChangeBatch } from '../../src/sync/types.js';

interface StoredBatch {
  namespace: string;
  device_id: string;
  sequence: string;
  produced_at: string;
  payload: ChangeBatch;
}

class InMemorySqlClient implements SqlClient {
  private readonly batches = new Map<string, StoredBatch>();
  private readonly cursors = new Map<string, Record<string, number>>();
  private batchesReady = false;
  private cursorsReady = false;

  async query<T>(sql: string, params: unknown[]): Promise<T[]> {
    if (sql.includes('SELECT COUNT(*) AS count')) {
      const deviceId = String(params[1]);
      const cutoff = Number(params[2] ?? -1);
      return [{ count: [...this.batches.values()].filter((batch) => batch.namespace === params[0]
        && batch.device_id === deviceId && Number(batch.sequence) <= cutoff).length }] as T[];
    }
    if (sql.includes('to_regclass')) {
      return [{ name: this.batchesReady ? 'memorix_sync_batches' : null }] as T[];
    }
    if (sql.includes('FROM memorix_sync_cursors') && this.cursorsReady) {
      const applied = this.cursors.get(String(params[0]));
      return (applied ? [{ applied: structuredClone(applied) }] : []) as T[];
    }
    if (sql.includes('SELECT payload FROM memorix_sync_batches') && this.batchesReady) {
      const key = `${params[0]}:${params[1]}:${params[2]}`;
      const row = this.batches.get(key);
      return (row ? [{ payload: structuredClone(row.payload) }] : []) as T[];
    }
    if (sql.includes('FROM memorix_sync_batches') && this.batchesReady) {
      const since = new Map<string, number>();
      for (const match of sql.matchAll(/device_id = \$(\d+) AND sequence > \$(\d+)/g)) {
        since.set(String(params[Number(match[1]) - 1]), Number(params[Number(match[2]) - 1]));
      }
      const afterMatch = /device_id > \$(\d+) OR \(device_id = \$(\d+) AND sequence > \$(\d+)\)/.exec(sql);
      const after = afterMatch ? {
        deviceId: String(params[Number(afterMatch[1]) - 1]),
        sequence: Number(params[Number(afterMatch[3]) - 1]),
      } : undefined;
      const limit = Number(params[params.length - 1]);
      const rows = [...this.batches.values()]
        .filter((row) => row.namespace === params[0])
        .filter((row) => since.size === 0 || Number(row.sequence) > (since.get(row.device_id) ?? -1))
        .filter((row) => !after || row.device_id > after.deviceId
          || (row.device_id === after.deviceId && Number(row.sequence) > after.sequence))
        .sort((left, right) => left.device_id === right.device_id
          ? Number(left.sequence) - Number(right.sequence)
          : left.device_id < right.device_id ? -1 : 1)
        .slice(0, limit);
      return rows
        .map((row) => structuredClone(row)) as T[];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }

  async exec(sql: string, params: unknown[]): Promise<void> {
    if (sql.includes('CREATE TABLE IF NOT EXISTS memorix_sync_batches')) {
      this.batchesReady = true;
      return;
    }
    if (sql.includes('CREATE TABLE IF NOT EXISTS memorix_sync_cursors')) {
      this.cursorsReady = true;
      return;
    }
    if (sql.includes('ALTER TABLE memorix_sync_batches') || sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS memorix_sync_batches_scope_key')) {
      return;
    }
    if (sql.includes('INSERT INTO memorix_sync_batches') && this.batchesReady) {
      const [namespace, deviceId, sequence, producedAt, encodedPayload] = params as [string, string, number, string, string];
      const key = `${namespace}:${deviceId}:${sequence}`;
      if (!this.batches.has(key)) {
        this.batches.set(key, {
          namespace,
          device_id: deviceId,
          sequence: String(sequence),
          produced_at: producedAt,
          payload: JSON.parse(encodedPayload) as ChangeBatch,
        });
      }
      return;
    }
    if (sql.includes('INSERT INTO memorix_sync_cursors') && this.cursorsReady) {
      const [deviceId, encodedApplied] = params as [string, string];
      this.cursors.set(deviceId, JSON.parse(encodedApplied) as Record<string, number>);
      return;
    }
    if (sql.includes('DELETE FROM memorix_sync_batches')) {
      const deviceId = String(params[1]);
      const cutoff = Number(params[2] ?? -1);
      for (const [key, batch] of this.batches) {
        if (batch.namespace === params[0] && batch.device_id === deviceId && Number(batch.sequence) <= cutoff) {
          this.batches.delete(key);
        }
      }
      return;
    }
    throw new Error(`Unexpected exec: ${sql}`);
  }
}

function batch(deviceId: string, sequence: number): ChangeBatch {
  return {
    formatVersion: 3,
    namespace: 'project-test',
    projectId: 'p',
    deviceId,
    sequence,
    producedAt: `2026-09-06T00:00:0${sequence}.000Z`,
    entries: [],
  };
}

describe('PostgresSyncRemote', () => {
  it('stores a repeated device sequence only once', async () => {
    const remote = new PostgresSyncRemote(new InMemorySqlClient(), 'project-test');
    const change = batch('device-a', 1);

    await remote.init();
    await remote.init();
    await remote.push(change);
    await remote.push(change);

    expect((await remote.pull({}, 10)).batches).toEqual([change]);
    await expect(remote.push({ ...change, producedAt: '2026-09-06T01:00:00.000Z' }))
      .rejects.toThrow(/different payload/);
  });

  it('pulls all devices after their own local cursors', async () => {
    const remote = new PostgresSyncRemote(new InMemorySqlClient(), 'project-test');
    await remote.init();
    await remote.push(batch('device-b', 2));
    await remote.push(batch('device-a', 2));
    await remote.push(batch('device-b', 1));
    await remote.push(batch('device-a', 1));

    const pulled = await remote.pull({ 'device-a': 1 }, 10);

    expect(pulled.batches.map(({ deviceId, sequence }) => [deviceId, sequence])).toEqual([
      ['device-a', 2],
      ['device-b', 1],
      ['device-b', 2],
    ]);
  });

  it('paginates remote batches', async () => {
    const remote = new PostgresSyncRemote(new InMemorySqlClient(), 'project-test');
    await remote.init();
    await remote.push(batch('device-a', 1));
    await remote.push(batch('device-a', 2));

    const page = await remote.pull({}, 1);
    expect(page.batches).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    const next = await remote.pull({}, 1, page.nextPageToken);
    expect(next.batches).toHaveLength(1);
    expect(next.batches[0].sequence).toBe(2);
  });

  it('applies the keyset continuation after the per-device cursor filter', async () => {
    const remote = new PostgresSyncRemote(new InMemorySqlClient(), 'project-test');
    await remote.init();
    await remote.push(batch('device-a', 1));
    await remote.push(batch('device-a', 2));
    await remote.push(batch('device-b', 1));

    const first = await remote.pull({ 'device-a': 1 }, 1);
    expect(first.batches.map(({ deviceId, sequence }) => [deviceId, sequence])).toEqual([['device-a', 2]]);
    const second = await remote.pull({ 'device-a': 1 }, 1, first.nextPageToken);
    expect(second.batches.map(({ deviceId, sequence }) => [deviceId, sequence])).toEqual([['device-b', 1]]);
  });

  it('supports explicit dry-run and applied compaction', async () => {
    const remote = new PostgresSyncRemote(new InMemorySqlClient(), 'project-test');
    await remote.init();
    await remote.push(batch('device-a', 1));
    await remote.push(batch('device-a', 2));
    expect(await remote.compact({ 'device-a': 1 }, { dryRun: true })).toEqual({ candidates: 1, deleted: 0 });
    expect(await remote.compact({ 'device-a': 1 })).toEqual({ candidates: 1, deleted: 1 });
  });
});
