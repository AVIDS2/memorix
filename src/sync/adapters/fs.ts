import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { emptyCursor } from '../types.js';
import type { ChangeBatch, SyncCursor, SyncRemote } from '../types.js';

export interface FsRemoteOptions {
  root: string;
}

export class FsRemote implements SyncRemote {
  readonly kind = 'fs';

  constructor(private readonly options: FsRemoteOptions) {}

  async init(): Promise<void> {
    await Promise.all([
      mkdir(this.batchesPath, { recursive: true }),
      mkdir(this.cursorsPath, { recursive: true }),
    ]);
  }

  async getCursor(deviceId: string): Promise<SyncCursor> {
    try {
      return JSON.parse(await readFile(this.cursorPath(deviceId), 'utf8')) as SyncCursor;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyCursor();
      throw error;
    }
  }

  async setCursor(deviceId: string, cursor: SyncCursor): Promise<void> {
    await atomicWrite(this.cursorPath(deviceId), cursor);
  }

  async push(batch: ChangeBatch): Promise<void> {
    const directory = path.join(this.batchesPath, batch.deviceId);
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, `${String(batch.sequence).padStart(20, '0')}.json`);
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

  async pull(since: Record<string, number>): Promise<ChangeBatch[]> {
    const batches: ChangeBatch[] = [];
    const devices = await readdir(this.batchesPath, { withFileTypes: true });

    for (const device of devices) {
      if (!device.isDirectory()) continue;
      const directory = path.join(this.batchesPath, device.name);
      const files = await readdir(directory, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile() || !/^\d+\.json$/.test(file.name)) continue;
        const sequence = Number.parseInt(file.name, 10);
        if (sequence <= (since[device.name] ?? 0)) continue;
        batches.push(JSON.parse(await readFile(path.join(directory, file.name), 'utf8')) as ChangeBatch);
      }
    }

    return batches.sort((left, right) => {
      if (left.deviceId < right.deviceId) return -1;
      if (left.deviceId > right.deviceId) return 1;
      return left.sequence - right.sequence;
    });
  }

  async close(): Promise<void> {}

  private get batchesPath(): string {
    return path.join(this.options.root, 'batches');
  }

  private get cursorsPath(): string {
    return path.join(this.options.root, 'cursors');
  }

  private cursorPath(deviceId: string): string {
    return path.join(this.cursorsPath, `${deviceId}.json`);
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
