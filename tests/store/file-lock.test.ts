import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { acquireLock, releaseLock, withFileLock, atomicWriteFile } from '../../src/store/file-lock.js';

describe('File Lock', () => {
  let tmpDir: string;
  let lockPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-lock-test-'));
    lockPath = path.join(tmpDir, '.memorix.lock');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('acquireLock / releaseLock', () => {
    it('should create and remove lock file', async () => {
      await acquireLock(lockPath);
      const exists = await fs.access(lockPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      await releaseLock(lockPath);
      const existsAfter = await fs.access(lockPath).then(() => true).catch(() => false);
      expect(existsAfter).toBe(false);
    });

    it('should write pid and timestamp to lock file', async () => {
      await acquireLock(lockPath);
      const content = JSON.parse(await fs.readFile(lockPath, 'utf-8'));
      expect(content.pid).toBe(process.pid);
      expect(content.time).toBeGreaterThan(0);
      await releaseLock(lockPath);
    });

    it('should handle stale locks (older than 10s)', async () => {
      // Create a stale lock
      await fs.writeFile(lockPath, JSON.stringify({ pid: 99999, time: Date.now() - 15000 }));
      // Manually set mtime to the past
      const pastTime = new Date(Date.now() - 15000);
      await fs.utimes(lockPath, pastTime, pastTime);

      // Should acquire despite existing lock (it's stale)
      await acquireLock(lockPath);
      const content = JSON.parse(await fs.readFile(lockPath, 'utf-8'));
      expect(content.pid).toBe(process.pid);
      await releaseLock(lockPath);
    });

    it('releaseLock should not throw if lock does not exist', async () => {
      await expect(releaseLock(lockPath)).resolves.toBeUndefined();
    });
  });

  describe('withFileLock', () => {
    it('should execute function and return result', async () => {
      const result = await withFileLock(tmpDir, async () => {
        return 42;
      });
      expect(result).toBe(42);
    });

    it('should release lock even if function throws', async () => {
      await expect(
        withFileLock(tmpDir, async () => {
          throw new Error('test error');
        }),
      ).rejects.toThrow('test error');

      // Lock should be released
      const exists = await fs.access(lockPath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it('should serialize concurrent access', async () => {
      const order: number[] = [];

      const task = (id: number, delayMs: number) =>
        withFileLock(tmpDir, async () => {
          order.push(id);
          await new Promise(r => setTimeout(r, delayMs));
          order.push(id * 10);
        });

      // Start two tasks concurrently — they should serialize
      await Promise.all([task(1, 50), task(2, 10)]);

      // First task should complete fully before second starts
      // Either [1, 10, 2, 20] or [2, 20, 1, 10] — no interleaving
      const firstStart = order[0];
      const firstEnd = order[1];
      expect(firstEnd).toBe(firstStart * 10);
    });
  });

  describe('atomicWriteFile', () => {
    it('should write file content correctly', async () => {
      const filePath = path.join(tmpDir, 'test.json');
      await atomicWriteFile(filePath, '{"hello":"world"}');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('{"hello":"world"}');
    });

    it('should overwrite existing file atomically', async () => {
      const filePath = path.join(tmpDir, 'test.json');
      await atomicWriteFile(filePath, 'old content');
      await atomicWriteFile(filePath, 'new content');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('new content');
    });

    it('should not leave tmp files on success', async () => {
      const filePath = path.join(tmpDir, 'test.json');
      await atomicWriteFile(filePath, 'data');
      const files = await fs.readdir(tmpDir);
      const tmpFiles = files.filter(f => f.includes('.tmp'));
      expect(tmpFiles).toHaveLength(0);
    });
  });
});
