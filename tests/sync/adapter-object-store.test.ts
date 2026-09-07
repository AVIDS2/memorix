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

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(prefix: string, options: { limit?: number; cursor?: string } = {}): Promise<{ keys: string[]; nextCursor?: string }> {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    const offset = Number.parseInt(options.cursor ?? '0', 10) || 0;
    const limit = options.limit ?? keys.length;
    const page = keys.slice(offset, offset + limit);
    return { keys: page, nextCursor: keys.length > offset + limit ? String(offset + limit) : undefined };
  }
}

function batch(deviceId: string, sequence: number, producedAt = '2026-09-06T00:00:00.000Z'): ChangeBatch {
  return { formatVersion: 3, namespace: 'project-test', projectId: 'p', deviceId, sequence, producedAt, entries: [] };
}

describe('ObjectStoreRemote', () => {
  it('keeps the first batch stored for a device sequence', async () => {
    const client = new MemoryObjectStore();
    const remote = new ObjectStoreRemote(client, 'project-test');
    const first = batch('device-a', 7);

    await remote.push(first);
    await remote.push({ ...first, producedAt: '2026-09-06T01:00:00.000Z' });

    expect([...client.objects.keys()]).toEqual([
      'projects/project-test/batches/device-a/00000000000000000007.jsonl',
    ]);
    expect((await remote.pull({}, 10)).batches).toEqual([first]);
  });

  it('pulls unseen batches from every device in device and numeric sequence order', async () => {
    const remote = new ObjectStoreRemote(new MemoryObjectStore(), 'project-test');
    await remote.push(batch('device-b', 12));
    await remote.push(batch('device-a', 10));
    await remote.push(batch('device-b', 2));
    await remote.push(batch('device-a', 2));

    const pulled = await remote.pull({ 'device-a': 2 }, 10);

    expect(pulled.batches.map(({ deviceId, sequence }) => [deviceId, sequence])).toEqual([
      ['device-a', 10],
      ['device-b', 2],
      ['device-b', 12],
    ]);
  });

  it('paginates batches without storing cursors in the remote', async () => {
    const remote = new ObjectStoreRemote(new MemoryObjectStore(), 'project-test');
    await remote.push(batch('device-a', 1));
    await remote.push(batch('device-a', 2));
    const page = await remote.pull({}, 1);
    expect(page.batches).toHaveLength(1);
    expect(page.hasMore).toBe(true);
  });
});
