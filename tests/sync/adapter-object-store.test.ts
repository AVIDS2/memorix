import { describe, expect, it } from 'vitest';
import {
  ObjectStoreRemote,
  type ObjectStoreClient,
} from '../../src/sync/adapters/object-store.js';
import type { ChangeBatch } from '../../src/sync/types.js';

class MemoryObjectStore implements ObjectStoreClient {
  readonly objects = new Map<string, string>();

  async putIfAbsent(key: string, body: string): Promise<void> {
    if (!this.objects.has(key)) this.objects.set(key, body);
  }

  async get(key: string): Promise<string | undefined> {
    return this.objects.get(key);
  }

  async put(key: string, body: string): Promise<void> {
    this.objects.set(key, body);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix));
  }
}

function batch(deviceId: string, sequence: number, producedAt = '2026-09-06T00:00:00.000Z'): ChangeBatch {
  return { formatVersion: 1, deviceId, sequence, producedAt, entries: [] };
}

describe('ObjectStoreRemote', () => {
  it('keeps the first batch stored for a device sequence', async () => {
    const client = new MemoryObjectStore();
    const remote = new ObjectStoreRemote(client);
    const first = batch('device-a', 7);

    await remote.push(first);
    await remote.push({ ...first, producedAt: '2026-09-06T01:00:00.000Z' });

    expect([...client.objects.keys()]).toEqual([
      'batches/device-a/00000000000000000007.json',
    ]);
    expect(await remote.pull({})).toEqual([first]);
  });

  it('pulls unseen batches from every device in device and numeric sequence order', async () => {
    const remote = new ObjectStoreRemote(new MemoryObjectStore());
    await remote.push(batch('device-b', 12));
    await remote.push(batch('device-a', 10));
    await remote.push(batch('device-b', 2));
    await remote.push(batch('device-a', 2));

    const pulled = await remote.pull({ 'device-a': 2 });

    expect(pulled.map(({ deviceId, sequence }) => [deviceId, sequence])).toEqual([
      ['device-a', 10],
      ['device-b', 2],
      ['device-b', 12],
    ]);
  });

  it('round-trips independent cursors for each device', async () => {
    const remote = new ObjectStoreRemote(new MemoryObjectStore());

    expect(await remote.getCursor('laptop')).toEqual({ applied: {} });
    await remote.setCursor('laptop', { applied: { phone: 4 } });
    await remote.setCursor('desktop', { applied: { phone: 9 } });

    expect(await remote.getCursor('laptop')).toEqual({ applied: { phone: 4 } });
    expect(await remote.getCursor('desktop')).toEqual({ applied: { phone: 9 } });
  });
});
