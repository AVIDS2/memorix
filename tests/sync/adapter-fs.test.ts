import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FsRemote } from '../../src/sync/adapters/fs.js';
import type { ChangeBatch } from '../../src/sync/types.js';

function batch(deviceId: string, sequence: number): ChangeBatch {
  return {
    formatVersion: 3,
    namespace: 'project-test',
    projectId: 'p',
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
    remote = new FsRemote({ root, namespace: 'project-test' });
    await remote.init();
  });

  afterEach(async () => {
    await remote.close();
    await rm(root, { recursive: true, force: true });
  });

  it('stores a pushed device sequence once', async () => {
    const value = batch('device-a', 7);
    const competingRemote = new FsRemote({ root, namespace: 'project-test' });
    await competingRemote.init();

    await Promise.all([remote.push(value), competingRemote.push(value)]);
    await competingRemote.close();

    const files = await readdir(path.join(root, 'projects', 'project-test', 'batches', 'device-a'));
    expect(files).toEqual(['00000000000000000007.jsonl']);
    const pulled = await remote.pull({}, 10);
    expect(pulled.batches).toHaveLength(1);
    expect(pulled.batches[0]).toEqual(value);

    await expect(remote.push({ ...value, producedAt: '2026-09-06T02:00:00.000Z' }))
      .rejects.toThrow(/different payload/);
  });

  it('pulls all devices in device and sequence order after each device cursor', async () => {
    await remote.push(batch('device-b', 2));
    await remote.push(batch('device-a', 2));
    await remote.push(batch('device-b', 1));
    await remote.push(batch('device-a', 1));
    await remote.push(batch('device-c', 1));

    const pulled = await remote.pull({ 'device-a': 1, 'device-b': 0, 'device-c': 1 }, 10);

    expect(pulled.batches.map(({ deviceId, sequence }) => [deviceId, sequence])).toEqual([
      ['device-a', 2],
      ['device-b', 1],
      ['device-b', 2],
    ]);
  });

  it('paginates batches without a remote cursor file', async () => {
    await remote.push(batch('device-a', 1));
    await remote.push(batch('device-a', 2));
    const page = await remote.pull({}, 1);
    expect(page.batches).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    const next = await remote.pull({}, 1, page.nextPageToken);
    expect(next.batches.map((item) => item.sequence)).toEqual([2]);
    expect(next.hasMore).toBe(false);
  });

  it('compacts only the explicitly acknowledged sequence', async () => {
    await remote.push(batch('device-a', 1));
    await remote.push(batch('device-a', 2));
    expect(await remote.compact({ 'device-a': 1 }, { dryRun: true })).toEqual({ candidates: 1, deleted: 0 });
    expect(await remote.compact({ 'device-a': 1 })).toEqual({ candidates: 1, deleted: 1 });
    expect((await remote.pull({}, 10)).batches.map((item) => item.sequence)).toEqual([2]);
  });
});
