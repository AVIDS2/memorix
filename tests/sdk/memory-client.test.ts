import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryClient, createMemoryClient } from '../../src/sdk.js';
import { initObservationStore, resetObservationStore } from '../../src/store/obs-store.js';
import { initObservations, prepareSearchIndex, getAllObservations, getObservation } from '../../src/memory/observations.js';
import { resetDb } from '../../src/store/orama-store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// Shared test data dir
let testDir: string;
let dataDir: string;

function createTestGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'memorix-sdk-test-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Memorix Test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "tests@memorix.local"', { cwd: dir, stdio: 'ignore' });
  execSync('git commit --allow-empty -m "init"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('MemoryClient (unit)', () => {
  beforeEach(async () => {
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

  beforeEach(() => {
    repoDir = createTestGitRepo();
  });

  afterEach(async () => {
    resetObservationStore();
    await resetDb();
    try { rmSync(repoDir, { recursive: true, force: true }); } catch { /* best effort */ }
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

  it('should throw for non-git directory', async () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), 'memorix-sdk-nogit-'));
    await expect(
      createMemoryClient({ projectRoot: nonGitDir, silent: true }),
    ).rejects.toThrow('No Git repository');
    try { rmSync(nonGitDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });
});
