/**
 * Persistence Layer Tests
 *
 * TDD: RED phase — these tests should fail initially for any
 * untested functionality, then pass after implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getProjectDataDir,
  saveGraphJsonl,
  loadGraphJsonl,
  saveObservationsJson,
  loadObservationsJson,
  saveIdCounter,
  loadIdCounter,
  getDbFilePath,
  getGraphFilePath,
} from '../../src/store/persistence.js';

let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-persist-'));
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe('Persistence Layer', () => {
  describe('getProjectDataDir', () => {
    it('should create global data directory (projectId is metadata only)', async () => {
      const dir = await getProjectDataDir('user/repo', testDir);
      // Global storage: all projects share the same base directory
      expect(dir).toBe(testDir);
      const stat = await fs.stat(dir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should be idempotent', async () => {
      const dir1 = await getProjectDataDir('my/project', testDir);
      const dir2 = await getProjectDataDir('my/project', testDir);
      expect(dir1).toBe(dir2);
    });
  });

  describe('Knowledge Graph JSONL (MCP compatible)', () => {
    it('should save and load entities', async () => {
      const entities = [
        { name: 'auth', entityType: 'module', observations: ['uses JWT'] },
        { name: 'db', entityType: 'service', observations: ['PostgreSQL', 'port 5432'] },
      ];
      await saveGraphJsonl(testDir, entities, []);
      const loaded = await loadGraphJsonl(testDir);
      expect(loaded.entities).toHaveLength(2);
      expect(loaded.entities[0].name).toBe('auth');
      expect(loaded.entities[0].observations).toEqual(['uses JWT']);
      expect(loaded.entities[1].observations).toHaveLength(2);
    });

    it('should save and load relations', async () => {
      const relations = [
        { from: 'auth', to: 'db', relationType: 'reads' },
      ];
      await saveGraphJsonl(testDir, [], relations);
      const loaded = await loadGraphJsonl(testDir);
      expect(loaded.relations).toHaveLength(1);
      expect(loaded.relations[0].from).toBe('auth');
    });

    it('should return empty graph for non-existent file', async () => {
      const loaded = await loadGraphJsonl(testDir);
      expect(loaded.entities).toHaveLength(0);
      expect(loaded.relations).toHaveLength(0);
    });

    it('should produce valid JSONL format', async () => {
      await saveGraphJsonl(
        testDir,
        [{ name: 'x', entityType: 't', observations: [] }],
        [{ from: 'x', to: 'x', relationType: 'self' }],
      );
      const raw = await fs.readFile(getGraphFilePath(testDir), 'utf-8');
      const lines = raw.split('\n').filter(Boolean);
      expect(lines).toHaveLength(2);
      // Each line should be valid JSON
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });
  });

  describe('Observations JSON', () => {
    it('should save and load observations array', async () => {
      const observations = [
        { id: 1, title: 'test obs', type: 'gotcha' },
        { id: 2, title: 'another', type: 'decision' },
      ];
      await saveObservationsJson(testDir, observations);
      const loaded = await loadObservationsJson(testDir);
      expect(loaded).toHaveLength(2);
      expect((loaded[0] as any).title).toBe('test obs');
    });

    it('should return empty array for non-existent file', async () => {
      const loaded = await loadObservationsJson(testDir);
      expect(loaded).toEqual([]);
    });
  });

  describe('ID Counter', () => {
    it('should save and load counter', async () => {
      await saveIdCounter(testDir, 42);
      const loaded = await loadIdCounter(testDir);
      expect(loaded).toBe(42);
    });

    it('should return 1 for non-existent counter', async () => {
      const loaded = await loadIdCounter(testDir);
      expect(loaded).toBe(1);
    });
  });

  describe('File paths', () => {
    it('should generate correct db file path', () => {
      const p = getDbFilePath('/some/dir');
      expect(p).toContain('memorix.msp');
    });

    it('should generate correct graph file path', () => {
      const p = getGraphFilePath('/some/dir');
      expect(p).toContain('graph.jsonl');
    });
  });
});
