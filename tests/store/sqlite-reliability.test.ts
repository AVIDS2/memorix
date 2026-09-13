import { afterEach, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeAllDatabases, getDatabase } from '../../src/store/sqlite-db.js';
import { createObservationStore, DegradedBackend } from '../../src/store/obs-store.js';
import {
  SessionGracefulDegrade,
  SessionSqliteStore,
  initSessionStore,
  resetSessionStore,
} from '../../src/store/session-store.js';
import {
  MiniSkillGracefulDegrade,
  MiniSkillSqliteStore,
  initMiniSkillStore,
  resetMiniSkillStore,
} from '../../src/store/mini-skill-store.js';
import { isTransientSqliteError, retrySqliteBusy } from '../../src/store/sqlite-reliability.js';

let tempDir = '';

afterEach(async () => {
  vi.restoreAllMocks();
  resetSessionStore();
  resetMiniSkillStore();
  closeAllDatabases();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('SQLite reliability across all durable stores', () => {
  it('classifies cross-process BUSY as retryable but same-connection LOCKED as a bug', () => {
    expect(isTransientSqliteError(Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }))).toBe(true);
    expect(isTransientSqliteError(Object.assign(new Error('database is locked'), { code: 'SQLITE_LOCKED' }))).toBe(false);
  });

  it('retries a transient atomic write conflict and keeps the transaction usable', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'memorix-atomic-lock-'));
    const store = await createObservationStore(tempDir);
    const db = getDatabase(tempDir);
    const originalPrepare = db.prepare.bind(db);
    let injected = false;
    db.prepare = (sql: string, ...args: unknown[]) => {
      if (sql === 'BEGIN IMMEDIATE' && !injected) {
        injected = true;
        return { run: () => { throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }); } };
      }
      return originalPrepare(sql, ...args);
    };

    await expect(store.atomic(async (tx) => tx.loadIdCounter())).resolves.toBe(1);
    expect(injected).toBe(true);
  });

  it('waits for a real cross-process writer and reopens the store', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'memorix-process-lock-'));
    getDatabase(tempDir);
    closeAllDatabases();

    const dbPath = path.join(tempDir, 'memorix.db');
    const child = spawn(process.execPath, [
      '--input-type=module',
      '-e',
      `let db;
try {
  const mod = await import('better-sqlite3');
  db = new mod.default(process.argv[1]);
  db.pragma('busy_timeout = 0');
} catch {
  const { DatabaseSync } = await import('node:sqlite');
  db = new DatabaseSync(process.argv[1]);
  db.exec('PRAGMA busy_timeout = 0');
}
db.prepare('BEGIN IMMEDIATE').run();
process.stdout.write('LOCKED\\n');
setTimeout(() => { db.prepare('COMMIT').run(); db.close(); }, 350);`,
      dbPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

    let output = '';
    let errorOutput = '';
    const onData = (chunk: Buffer) => { output += chunk.toString(); };
    const onErrorData = (chunk: Buffer) => { errorOutput += chunk.toString(); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onErrorData);
    const closed = once(child, 'close');
    const locked = new Promise<void>((resolve, reject) => {
      const onLockedData = () => {
        if (output.includes('LOCKED')) {
          child.stdout.off('data', onLockedData);
          resolve();
        }
      };
      child.stdout.on('data', onLockedData);
      child.once('error', reject);
      child.once('close', (code) => {
        if (code !== 0 || !output.includes('LOCKED')) {
          reject(new Error(`lock holder exited (code ${code}): ${errorOutput}`));
        }
      });
    });
    const deadline = setTimeout(() => child.kill(), 5_000);
    try {
      await locked;

      const startedAt = Date.now();
      const store = await createObservationStore(tempDir);
      expect(store.getBackendName()).toBe('sqlite');
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250);
    } finally {
      clearTimeout(deadline);
      child.stdout.off('data', onData);
      child.stderr.off('data', onErrorData);
      if (child.exitCode === null) {
        child.kill();
        await closed.catch(() => undefined);
      }
    }
  });

  it('does not convert a persistent session initialization error into a fallback', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'memorix-session-error-'));
    vi.spyOn(SessionSqliteStore.prototype, 'init').mockRejectedValue(
      Object.assign(new Error('database schema is malformed'), { code: 'SQLITE_CORRUPT' }),
    );

    await expect(initSessionStore(tempDir)).rejects.toThrow(/malformed/i);
  });

  it('does not convert a persistent mini-skill initialization error into a fallback', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'memorix-skill-error-'));
    vi.spyOn(MiniSkillSqliteStore.prototype, 'init').mockRejectedValue(
      Object.assign(new Error('database schema is malformed'), { code: 'SQLITE_CORRUPT' }),
    );

    await expect(initMiniSkillStore(tempDir)).rejects.toThrow(/malformed/i);
  });

  it('makes degraded session and mini-skill writes explicit failures', async () => {
    const observationStore = new DegradedBackend('SQLite driver is missing');
    const sessionStore = new SessionGracefulDegrade();
    const skillStore = new MiniSkillGracefulDegrade();
    await sessionStore.init(os.tmpdir());
    await skillStore.init(os.tmpdir());

    expect(observationStore.getBackendReason()).toBe('SQLite driver is missing');
    expect(sessionStore.getBackendReason()).toBe('SQLite runtime unavailable');
    expect(skillStore.getBackendReason()).toBe('SQLite runtime unavailable');
    await expect(observationStore.loadAll()).rejects.toThrow(/memory is not loaded/i);
    await expect(sessionStore.loadAll()).rejects.toThrow(/memory is not loaded/i);
    await expect(sessionStore.insert({ id: 's1' } as any)).rejects.toThrow(/read-only/i);
    await expect(skillStore.loadAll()).rejects.toThrow(/memory is not loaded/i);
    await expect(skillStore.atomicInsertWithId({ title: 'skill' } as any)).rejects.toThrow(/read-only/i);
  });

  it('does not retry a non-transient operation failure', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('database schema is malformed'));
    await expect(retrySqliteBusy(operation, 'test')).rejects.toThrow(/malformed/i);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
