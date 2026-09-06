import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FsRemote } from '../../src/sync/adapters/fs.js';
import type { ChangeBatch } from '../../src/sync/types.js';

function batch(deviceId: string, sequence: number): ChangeBatch {
  return {
    formatVersion: 1,
    deviceId,
    sequence,
    producedAt: '2026-09-06T00:00:00.000Z',
    entries: [],
  };
}

describe('FsRemote', () => {
  let root: string;
  let remote: FsRemote;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'memorix-sync-fs-'));
    remote = new FsRemote({ root });
    await remote.init();
  });

  afterEach(async () => {
    await remote.close();
    await rm(root, { recursive: true, force: true });
  });

  it('stores a pushed device sequence once', async () => {
    const value = batch('device-a', 7);
    const duplicate = { ...value, producedAt: '2026-09-06T01:00:00.000Z' };
    const competingRemote = new FsRemote({ root });
    await competingRemote.init();

    await Promise.all([remote.push(value), competingRemote.push(duplicate)]);
    await competingRemote.close();

    const files = await readdir(path.join(root, 'batches', 'device-a'));
    expect(files).toEqual(['00000000000000000007.json']);
    const pulled = await remote.pull({});
    expect(pulled).toHaveLength(1);
    expect([value, duplicate]).toContainEqual(pulled[0]);

    await remote.push({ ...value, producedAt: '2026-09-06T02:00:00.000Z' });
    expect(await remote.pull({})).toEqual(pulled);
  });

  it('pulls all devices in device and sequence order after each device cursor', async () => {
    await remote.push(batch('device-b', 2));
    await remote.push(batch('device-a', 2));
    await remote.push(batch('device-b', 1));
    await remote.push(batch('device-a', 1));
    await remote.push(batch('device-c', 1));

    const pulled = await remote.pull({ 'device-a': 1, 'device-b': 0, 'device-c': 1 });

    expect(pulled.map(({ deviceId, sequence }) => [deviceId, sequence])).toEqual([
      ['device-a', 2],
      ['device-b', 1],
      ['device-b', 2],
    ]);
  });

  it('round-trips a cursor per device and defaults missing cursors to empty', async () => {
    expect(await remote.getCursor('device-a')).toEqual({ applied: {} });

    const cursor = { applied: { 'device-a': 3, 'device-b': 8 } };
    await remote.setCursor('device-a', cursor);
    await remote.close();
    remote = new FsRemote({ root });
    await remote.init();

    expect(await remote.getCursor('device-a')).toEqual(cursor);
    expect(await remote.getCursor('device-b')).toEqual({ applied: {} });
  });
});
