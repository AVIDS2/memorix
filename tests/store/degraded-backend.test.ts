import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

describe('DegradedBackend', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'memorix-degraded-'));
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('should be created when SQLite is unavailable', async () => {
    // Force SQLite import to fail by pointing at an empty dir (no DB)
    const { createObservationStore } = await import('../../src/store/obs-store.js');
    // This will still try SQLite first — if better-sqlite3 is installed it succeeds
    // So we test the DegradedBackend directly
    const { DegradedBackend } = await import('../../src/store/obs-store.js');
    const store = new DegradedBackend();
    await store.init(tmpDir);
    expect(store.getBackendName()).toBe('degraded');
  });

  it('should return empty observations on loadAll', async () => {
    const { DegradedBackend } = await import('../../src/store/obs-store.js');
    const store = new DegradedBackend();
    await store.init(tmpDir);
    const obs = await store.loadAll();
    expect(obs).toEqual([]);
  });

  it('should return 1 for loadIdCounter', async () => {
    const { DegradedBackend } = await import('../../src/store/obs-store.js');
    const store = new DegradedBackend();
    await store.init(tmpDir);
    const counter = await store.loadIdCounter();
    expect(counter).toBe(1);
  });

  it('should throw on all write operations', async () => {
    const { DegradedBackend } = await import('../../src/store/obs-store.js');
    const store = new DegradedBackend();
    await store.init(tmpDir);

    const fakeObs = { id: 1, entityName: 'test', type: 'gotcha', title: 't', narrative: '', facts: [], createdAt: '2026-01-01', projectId: 'p' } as any;

    await expect(store.insert(fakeObs)).rejects.toThrow('degraded mode');
    await expect(store.update(fakeObs)).rejects.toThrow('degraded mode');
    await expect(store.remove(1)).rejects.toThrow('degraded mode');
    await expect(store.bulkReplace([fakeObs])).rejects.toThrow('degraded mode');
    await expect(store.bulkRemoveByIds([1])).rejects.toThrow('degraded mode');
    await expect(store.saveIdCounter(2)).rejects.toThrow('degraded mode');
    await expect(store.atomic(async () => {})).rejects.toThrow('degraded mode');
  });

  it('should not write observations.json when SQLite is unavailable', async () => {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { DegradedBackend } = await import('../../src/store/obs-store.js');

    const store = new DegradedBackend();
    await store.init(tmpDir);

    // Attempt writes — they should throw, not create a JSON file
    try { await store.insert({ id: 1 } as any); } catch { /* expected */ }

    const jsonPath = join(tmpDir, 'observations.json');
    expect(existsSync(jsonPath)).toBe(false);
  });

  it('ensureFresh returns false and getGeneration returns 0', async () => {
    const { DegradedBackend } = await import('../../src/store/obs-store.js');
    const store = new DegradedBackend();
    await store.init(tmpDir);

    expect(await store.ensureFresh()).toBe(false);
    expect(store.getGeneration()).toBe(0);
  });

  it('close does not throw', async () => {
    const { DegradedBackend } = await import('../../src/store/obs-store.js');
    const store = new DegradedBackend();
    await store.init(tmpDir);
    expect(() => store.close()).not.toThrow();
  });
});
