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
  private batchesReady = false;

  async query<T>(sql: string, params: unknown[]): Promise<T[]> {
    if (sql.includes('SELECT COUNT(*) AS count')) {
      const cutoff = Number(params[2] ?? -1);
      return [{ count: [...this.batches.values()].filter((batch) => Number(batch.sequence) <= cutoff).length }] as T[];
    }
    if (sql.includes('FROM memorix_sync_batches') && this.batchesReady) {
      return [...this.batches.values()].map((row) => structuredClone(row)) as T[];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }

  async exec(sql: string, params: unknown[]): Promise<void> {
    if (sql.includes('CREATE TABLE IF NOT EXISTS memorix_sync_batches')) {
      this.batchesReady = true;
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
    if (sql.includes('DELETE FROM memorix_sync_batches')) {
      this.batches.clear();
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
