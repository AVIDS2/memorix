import { describe, expect, it } from 'vitest';
import {
  PostgresSyncRemote,
  type SqlClient,
} from '../../src/sync/adapters/postgres.js';
import type { ChangeBatch } from '../../src/sync/types.js';

interface StoredBatch {
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
    if (sql.includes('FROM memorix_sync_cursors') && this.cursorsReady) {
      const applied = this.cursors.get(String(params[0]));
      return (applied ? [{ applied: structuredClone(applied) }] : []) as T[];
    }

    if (sql.includes('FROM memorix_sync_batches') && this.batchesReady) {
      const since = JSON.parse(String(params[0])) as Record<string, number>;
      return [...this.batches.values()]
        .filter((row) => Number(row.sequence) > (since[row.device_id] ?? 0))
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

    if (sql.includes('INSERT INTO memorix_sync_batches') && this.batchesReady) {
      const [deviceId, sequence, producedAt, encodedPayload] = params as [string, number, string, string];
      const key = `${deviceId}:${sequence}`;
      if (this.batches.has(key)) {
        if (!sql.includes('ON CONFLICT (device_id, sequence) DO NOTHING')) {
          throw new Error('duplicate primary key');
        }
        return;
      }

      this.batches.set(key, {
        device_id: deviceId,
        sequence: String(sequence),
        produced_at: producedAt,
        payload: JSON.parse(encodedPayload) as ChangeBatch,
      });
      return;
    }

    if (sql.includes('INSERT INTO memorix_sync_cursors') && this.cursorsReady) {
      const [ownerDevice, encodedApplied] = params as [string, string];
      if (this.cursors.has(ownerDevice) && !sql.includes('ON CONFLICT (owner_device) DO UPDATE')) {
        throw new Error('duplicate primary key');
      }
      this.cursors.set(ownerDevice, JSON.parse(encodedApplied) as Record<string, number>);
      return;
    }

    throw new Error(`Unexpected exec: ${sql}`);
  }
}

function batch(deviceId: string, sequence: number): ChangeBatch {
  return {
    formatVersion: 1,
    deviceId,
    sequence,
    producedAt: `2026-09-06T00:00:0${sequence}.000Z`,
    entries: [],
  };
}

describe('PostgresSyncRemote', () => {
  it('stores a repeated device sequence only once', async () => {
    const remote = new PostgresSyncRemote(new InMemorySqlClient());
    const change = batch('device-a', 1);

    await remote.init();
    await remote.init();
    await remote.push(change);
    await remote.push(change);

    expect(await remote.pull({})).toEqual([change]);
  });

  it('pulls all devices after their own cursors in device and sequence order', async () => {
    const remote = new PostgresSyncRemote(new InMemorySqlClient());
    await remote.init();
    await remote.push(batch('device-b', 2));
    await remote.push(batch('device-a', 2));
    await remote.push(batch('device-b', 1));
    await remote.push(batch('device-a', 1));

    const pulled = await remote.pull({ 'device-a': 1 });

    expect(pulled.map(({ deviceId, sequence }) => [deviceId, sequence])).toEqual([
      ['device-a', 2],
      ['device-b', 1],
      ['device-b', 2],
    ]);
  });

  it('upserts and returns a cursor for each owner device', async () => {
    const remote = new PostgresSyncRemote(new InMemorySqlClient());
    await remote.init();

    expect(await remote.getCursor('laptop')).toEqual({ applied: {} });

    await remote.setCursor('laptop', { applied: { phone: 1 } });
    await remote.setCursor('laptop', { applied: { phone: 3, tablet: 2 } });

    expect(await remote.getCursor('laptop')).toEqual({ applied: { phone: 3, tablet: 2 } });
    expect(await remote.getCursor('desktop')).toEqual({ applied: {} });
  });
});
