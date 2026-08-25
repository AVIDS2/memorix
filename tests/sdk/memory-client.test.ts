import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryClient, createMemoryClient } from '../../src/sdk.js';
import { initObservationStore, resetObservationStore } from '../../src/store/obs-store.js';
import { initObservations, prepareSearchIndex, getAllObservations, getObservation, storeObservation } from '../../src/memory/observations.js';
import { resetDb } from '../../src/store/orama-store.js';
import { closeAllDatabases, getDatabase } from '../../src/store/sqlite-db.js';
import { resetProvider } from '../../src/embedding/provider.js';
import { resetConfigCache } from '../../src/config.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawnSync } from 'node:child_process';

// Shared test data dir
let testDir: string;
let dataDir: string;

const EMBEDDING_ENV_KEYS = [
  'MEMORIX_EMBEDDING',
  'MEMORIX_EMBEDDING_API_KEY',
  'MEMORIX_EMBEDDING_BASE_URL',
  'MEMORIX_EMBEDDING_MODEL',
  'MEMORIX_EMBEDDING_DIMENSIONS',
];
let savedEmbeddingEnv: Record<string, string | undefined> = {};

function forceEmbeddingOffForTest(): void {
  savedEmbeddingEnv = {};
  for (const key of EMBEDDING_ENV_KEYS) {
    savedEmbeddingEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.MEMORIX_EMBEDDING = 'off';
  resetConfigCache();
  resetProvider();
}

function restoreEmbeddingEnv(): void {
  resetProvider();
  for (const key of EMBEDDING_ENV_KEYS) {
    if (savedEmbeddingEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEmbeddingEnv[key];
    }
  }
  resetConfigCache();
}

function createTestGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'memorix-sdk-test-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Memorix Test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "tests@memorix.local"', { cwd: dir, stdio: 'ignore' });
  execSync('git commit --allow-empty -m "init"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

/**
 * Write through a child process so the parent MemoryClient cannot share a
 * SQLite handle or mutate the in-memory observation snapshot.
 */
function writeExternalObservation(input: {
  dataDir: string;
  projectId: string;
  id: number;
  title: string;
  nextId: number;
  updateId?: number;
  updateTitle?: string;
}): void {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `
      import { createRequire } from 'node:module';
      const require = createRequire(process.cwd() + '/package.json');
      function openDatabase(dbPath) {
        try {
          const Database = require('better-sqlite3');
          return new Database(dbPath);
        } catch {
          // Native binding may be compiled for a different Node than this child.
        }
        return new (require('node:sqlite').DatabaseSync)(dbPath);
      }
      const db = openDatabase(process.env.MEMORIX_WRITER_DB);
      if (process.env.MEMORIX_WRITER_UPDATE_ID) {
        db.prepare('UPDATE observations SET title = ? WHERE id = ?').run(
          process.env.MEMORIX_WRITER_UPDATE_TITLE,
          Number(process.env.MEMORIX_WRITER_UPDATE_ID),
        );
      }
      db.prepare(\`INSERT OR REPLACE INTO observations (
        id, entityName, type, title, narrative, facts, filesModified, concepts,
        tokens, createdAt, projectId, status, source, sourceDetail
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\`).run(
        Number(process.env.MEMORIX_WRITER_ID),
        'external-writer',
        'discovery',
        process.env.MEMORIX_WRITER_TITLE,
        'Inserted after MemoryClient.close()',
        '[]',
        '[]',
        '[]',
        8,
        new Date().toISOString(),
        process.env.MEMORIX_WRITER_PROJECT,
        'active',
        'agent',
        'external',
      );
      db.prepare("UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'storage_generation'").run();
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('next_id', ?)").run(process.env.MEMORIX_WRITER_NEXT_ID);
      db.close();
    `],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MEMORIX_WRITER_DB: join(input.dataDir, 'memorix.db'),
        MEMORIX_WRITER_ID: String(input.id),
        MEMORIX_WRITER_TITLE: input.title,
        MEMORIX_WRITER_PROJECT: input.projectId,
        MEMORIX_WRITER_NEXT_ID: String(input.nextId),
        ...(input.updateId !== undefined
          ? {
              MEMORIX_WRITER_UPDATE_ID: String(input.updateId),
              MEMORIX_WRITER_UPDATE_TITLE: input.updateTitle ?? '',
            }
          : {}),
      },
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    throw new Error(`external writer failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
}

describe('MemoryClient (unit)', () => {
  beforeEach(async () => {
    forceEmbeddingOffForTest();

    testDir = mkdtempSync(join(tmpdir(), 'memorix-sdk-unit-'));
    dataDir = join(testDir, 'data');
    // Initialize stores for direct MemoryClient construction
    await initObservationStore(dataDir);
    await initObservations(dataDir);
    await prepareSearchIndex();
  });

  afterEach(async () => {
    resetObservationStore();
    await resetDb();
    closeAllDatabases();
    restoreEmbeddingEnv();
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('should store and retrieve an observation', async () => {
    const client = new MemoryClient('test/project', testDir, dataDir);
    // Manually set up internal modules
    await client._init(true);

    const result = await client.store({
      entityName: 'auth-module',
      type: 'decision',
      title: 'Use JWT tokens',
      narrative: 'Decided to use JWT for stateless authentication.',
      facts: ['Token expiry: 1h'],
    });

    expect(result.observation).toBeDefined();
    expect(result.observation.title).toBe('Use JWT tokens');
    expect(result.observation.type).toBe('decision');
    expect(result.observation.projectId).toBe('test/project');
    expect(result.upserted).toBe(false);

    await client.close();
  });

  it('should search observations', async () => {
    const client = new MemoryClient('test/project', testDir, dataDir);
    await client._init(true);

    await client.store({
      entityName: 'auth-module',
      type: 'decision',
      title: 'Use JWT tokens',
      narrative: 'Decided to use JWT for stateless authentication.',
    });

    await client.store({
      entityName: 'database',
      type: 'decision',
      title: 'PostgreSQL for persistence',
      narrative: 'Chose PostgreSQL over MySQL for better JSON support.',
    });

    const results = await client.search({ query: 'JWT authentication' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toContain('JWT');

    await client.close();
  });

  it('should get observation by ID', async () => {
    const client = new MemoryClient('test/project', testDir, dataDir);
    await client._init(true);

    const { observation } = await client.store({
      entityName: 'config',
      type: 'gotcha',
      title: 'Env vars not loaded in test',
      narrative: 'dotenv must be called before config access.',
    });

    const fetched = await client.get(observation.id);
    expect(fetched).toBeDefined();
    expect(fetched!.title).toBe('Env vars not loaded in test');

    await client.close();
  });

  it('should get all project observations', async () => {
    const client = new MemoryClient('test/project', testDir, dataDir);
    await client._init(true);

    await client.store({ entityName: 'a', type: 'discovery', title: 'First', narrative: 'n1' });
    await client.store({ entityName: 'b', type: 'discovery', title: 'Second', narrative: 'n2' });

    const all = await client.getAll();
    expect(all.length).toBe(2);

    await client.close();
  });

  it('should count observations', async () => {
    const client = new MemoryClient('test/project', testDir, dataDir);
    await client._init(true);

    expect(await client.count()).toBe(0);

    await client.store({ entityName: 'a', type: 'discovery', title: 'One', narrative: 'n' });
    expect(await client.count()).toBe(1);

    await client.close();
  });

  it('keeps personal observations outside the default SDK reader and write scope', async () => {
    const client = new MemoryClient('test/project', testDir, dataDir);
    await client._init(true);

    const { observation: shared } = await client.store({
      entityName: 'shared',
      type: 'decision',
      title: 'Project-shared decision',
      narrative: 'All project readers can use this decision.',
    });
    const { observation: personal } = await storeObservation({
      entityName: 'private',
      type: 'discovery',
      title: 'Private operator note',
      narrative: 'An unbound SDK client must not expose or alter this note.',
      projectId: 'test/project',
      topicKey: 'private/operator-note',
      visibility: 'personal',
      createdByAgentId: 'private-agent',
    });

    expect(await client.get(personal.id)).toBeUndefined();
    expect((await client.getAll()).map((observation) => observation.id)).toEqual([shared.id]);
    expect(await client.count()).toBe(1);
    expect((await client.search({ query: 'private operator note' })).map((result) => result.id)).not.toContain(personal.id);

    const resolveResult = await client.resolve([personal.id]);
    expect(resolveResult.resolved).toEqual([]);
    expect(resolveResult.notFound).toContain(personal.id);

    await expect(client.store({
      entityName: 'private',
      type: 'discovery',
      title: 'Guessed private update',
      narrative: 'This must not overwrite the private record.',
      topicKey: 'private/operator-note',
    })).rejects.toThrow('write scope');

    await client.close();
  });

  it('should resolve observations', async () => {
    const client = new MemoryClient('test/project', testDir, dataDir);
    await client._init(true);

    const { observation } = await client.store({
      entityName: 'bug',
      type: 'problem-solution',
      title: 'Fix null pointer',
      narrative: 'Added null check.',
    });

    const result = await client.resolve([observation.id]);
    expect(result.resolved).toContain(observation.id);
    expect(result.notFound).toHaveLength(0);

    // Resolved observation should still exist but with resolved status
    const obs = await client.get(observation.id);
    expect(obs?.status).toBe('resolved');

    await client.close();
  });

  it('should throw after close', async () => {
    const client = new MemoryClient('test/project', testDir, dataDir);
    await client._init(true);
    await client.close();

    await expect(client.store({
      entityName: 'a', type: 'discovery', title: 't', narrative: 'n',
    })).rejects.toThrow('closed');
  });

  it('should expose project metadata', async () => {
    const client = new MemoryClient('test/project', testDir, dataDir);
    expect(client.projectId).toBe('test/project');
    expect(client.projectRoot).toBe(testDir);
    expect(client.dataDir).toBe(dataDir);
    await client.close();
  });
});

describe('createMemoryClient (integration)', () => {
  let repoDir: string;
  let isolatedDataDir: string;
  let previousDataDir: string | undefined;

  beforeEach(() => {
    forceEmbeddingOffForTest();
    repoDir = createTestGitRepo();
    isolatedDataDir = mkdtempSync(join(tmpdir(), 'memorix-sdk-data-'));
    previousDataDir = process.env.MEMORIX_DATA_DIR;
    process.env.MEMORIX_DATA_DIR = isolatedDataDir;
  });

  afterEach(async () => {
    resetObservationStore();
    await resetDb();
    restoreEmbeddingEnv();
    if (previousDataDir === undefined) delete process.env.MEMORIX_DATA_DIR;
    else process.env.MEMORIX_DATA_DIR = previousDataDir;
    try { rmSync(repoDir, { recursive: true, force: true }); } catch { /* best effort */ }
    try { rmSync(isolatedDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('should create a client from a Git repo path', async () => {
    const client = await createMemoryClient({ projectRoot: repoDir, silent: true });
    expect(client).toBeInstanceOf(MemoryClient);
    expect(client.projectId).toBeTruthy();
    expect(client.projectRoot).toBe(repoDir);

    // Store and verify round-trip
    const { observation } = await client.store({
      entityName: 'test-entity',
      type: 'discovery',
      title: 'SDK integration test',
      narrative: 'Verifying end-to-end SDK flow.',
    });
    expect(observation.id).toBeGreaterThan(0);

    const results = await client.search({ query: 'SDK integration' });
    expect(results.length).toBeGreaterThan(0);

    await client.close();
  });

  it('keeps createMemoryClient data under MEMORIX_DATA_DIR', async () => {
    const client = await createMemoryClient({ projectRoot: repoDir, silent: true });
    expect(client.dataDir).toBe(isolatedDataDir);
    await client.close();
  });

  it('releases SQLite so the temp dataDir can be deleted after close', async () => {
    const client = await createMemoryClient({ projectRoot: repoDir, silent: true });
    await client.store({
      entityName: 'close-release',
      type: 'discovery',
      title: 'Close must drop the SQLite lock',
      narrative: 'Windows cannot unlink memorix.db while the handle is open.',
    });
    expect(client.dataDir).toBe(isolatedDataDir);
    const openHandle = getDatabase(isolatedDataDir);
    await client.close();
    expect(() => openHandle.prepare('SELECT 1').get()).toThrow();
    await expect(rm(isolatedDataDir, { recursive: true, force: true })).resolves.toBeUndefined();
  });

  it('reloads SQLite after close so a later in-process client is not a stale snapshot', async () => {
    const clientA = await createMemoryClient({ projectRoot: repoDir, silent: true });
    const { observation } = await clientA.store({
      entityName: 'sdk-reopen',
      type: 'discovery',
      title: 'client-a-original-title',
      narrative: 'First SDK client snapshot that must not survive close + external write.',
    });
    expect(await clientA.count()).toBe(1);
    const dataDir = clientA.dataDir;
    const projectId = clientA.projectId;
    await clientA.close();

    const externalTitle = 'client-b-must-see-external-write';
    const updatedTitle = 'client-a-title-updated-after-close';
    writeExternalObservation({
      dataDir,
      projectId,
      id: observation.id + 1,
      title: externalTitle,
      nextId: observation.id + 2,
      updateId: observation.id,
      updateTitle: updatedTitle,
    });

    const clientB = await createMemoryClient({ projectRoot: repoDir, silent: true });
    const all = await clientB.getAll();
    expect(await clientB.count()).toBe(2);
    expect(all.map((row) => row.title)).toEqual(expect.arrayContaining([updatedTitle, externalTitle]));
    expect(all.map((row) => row.title)).not.toContain('client-a-original-title');
    await clientB.close();

    await expect(rm(isolatedDataDir, { recursive: true, force: true })).resolves.toBeUndefined();
  });

  it('should throw for non-git directory', async () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), 'memorix-sdk-nogit-'));
    await expect(
      createMemoryClient({ projectRoot: nonGitDir, silent: true }),
    ).rejects.toThrow('No Git repository');
    try { rmSync(nonGitDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });
});
