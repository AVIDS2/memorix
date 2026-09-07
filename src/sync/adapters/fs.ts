import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChangeBatch, SyncCompactReport, SyncPullPage, SyncRemote } from '../types.js';

export interface FsRemoteOptions {
  root: string;
  namespace: string;
}

export class FsRemote implements SyncRemote {
  readonly kind = 'fs';
  readonly namespace: string;

  constructor(private readonly options: FsRemoteOptions) {
    this.namespace = options.namespace;
  }

  async init(options: { create?: boolean } = {}): Promise<void> {
    if (options.create === false) return;
    await Promise.all([
      mkdir(this.batchesPath, { recursive: true }),
    ]);
  }

  async push(batch: ChangeBatch): Promise<void> {
    const directory = path.join(this.batchesPath, batch.deviceId);
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, `${String(batch.sequence).padStart(20, '0')}.jsonl`);
    if (await exists(target)) return;

    const lock = `${target}.lock`;
    for (;;) {
      try {
        await writeFile(lock, '', { flag: 'wx' });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (await exists(target)) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
    }

    try {
      if (!(await exists(target))) await atomicWrite(target, batch);
    } finally {
      await rm(lock, { force: true });
    }
  }

  async pull(since: Record<string, number>, limit: number, pageToken?: string): Promise<SyncPullPage> {
    const objects: Array<{ path: string; deviceId: string; sequence: number }> = [];
    let devices;
    try {
      devices = await readdir(this.batchesPath, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { batches: [], hasMore: false };
      throw error;
    }

    for (const device of devices) {
      if (!device.isDirectory()) continue;
      const directory = path.join(this.batchesPath, device.name);
      const files = await readdir(directory, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile() || !/^\d+\.jsonl$/.test(file.name)) continue;
        const sequence = Number.parseInt(file.name, 10);
        if (sequence <= (since[device.name] ?? 0)) continue;
        objects.push({ path: path.join(directory, file.name), deviceId: device.name, sequence });
      }
    }

    const sorted = objects.sort((left, right) => {
      if (left.deviceId < right.deviceId) return -1;
      if (left.deviceId > right.deviceId) return 1;
      return left.sequence - right.sequence;
    });
    const offset = Math.max(0, Number.parseInt(pageToken ?? '0', 10) || 0);
    const batches: ChangeBatch[] = [];
    for (const object of sorted.slice(offset, offset + limit)) {
      const raw = await readFile(object.path, 'utf8');
      for (const line of raw.split(/\r?\n/).filter(Boolean)) batches.push(JSON.parse(line) as ChangeBatch);
    }
    const nextOffset = offset + limit;
    return { batches, hasMore: sorted.length > nextOffset, nextPageToken: sorted.length > nextOffset ? String(nextOffset) : undefined };
  }

  async compact(through: Record<string, number>, options: { dryRun?: boolean } = {}): Promise<SyncCompactReport> {
    let candidates = 0;
    const files: string[] = [];
    let devices: Array<import('node:fs').Dirent>;
    try {
      devices = await readdir(this.batchesPath, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { candidates: 0, deleted: 0 };
      throw error;
    }
    for (const device of devices) {
      if (!device.isDirectory()) continue;
      const cutoff = through[device.name];
      if (!Number.isSafeInteger(cutoff)) continue;
      const directory = path.join(this.batchesPath, device.name);
      for (const file of await readdir(directory, { withFileTypes: true })) {
        if (!file.isFile() || !/^\d+\.jsonl$/.test(file.name)) continue;
        const sequence = Number.parseInt(file.name, 10);
        if (sequence <= cutoff) {
          candidates++;
          files.push(path.join(directory, file.name));
        }
      }
    }
    if (!options.dryRun) for (const file of files) await rm(file, { force: true });
    return { candidates, deleted: options.dryRun ? 0 : files.length };
  }

  async close(): Promise<void> {}

  private get batchesPath(): string {
    return path.join(this.options.root, 'projects', this.options.namespace, 'batches');
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function atomicWrite(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
