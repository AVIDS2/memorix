/**
 * Knowledge Graph Manager Tests
 *
 * Tests the Entity-Relation-Observation knowledge graph operations.
 * Based on MCP Official Memory Server behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { KnowledgeGraphManager } from '../../src/memory/graph.js';
import { closeDatabase, closeAllDatabases } from '../../src/store/sqlite-db.js';
import { resetGraphStore } from '../../src/store/graph-store.js';

let testDir: string;
let manager: KnowledgeGraphManager;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-test-'));
  manager = new KnowledgeGraphManager(testDir);
});

afterEach(async () => {
  resetGraphStore();
  closeDatabase(testDir);
  // Give Windows a moment to release file locks
  await new Promise(r => setTimeout(r, 50));
  try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* EBUSY on Windows — ignore */ }
});

describe('KnowledgeGraphManager', () => {
  describe('createEntities', () => {
    it('should create new entities', async () => {
      const result = await manager.createEntities([
        { name: 'auth-module', entityType: 'component', observations: ['Uses JWT'] },
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('auth-module');
    });

    it('should skip duplicate entities by name', async () => {
      await manager.createEntities([
        { name: 'auth-module', entityType: 'component', observations: [] },
      ]);
      const result = await manager.createEntities([
        { name: 'auth-module', entityType: 'service', observations: ['duplicate'] },
      ]);
      expect(result).toHaveLength(0);
    });
  });

  describe('createRelations', () => {
    it('should create new relations', async () => {
      await manager.createEntities([
        { name: 'auth', entityType: 'module', observations: [] },
        { name: 'jwt', entityType: 'library', observations: [] },
      ]);
      const result = await manager.createRelations([
        { from: 'auth', to: 'jwt', relationType: 'depends_on' },
      ]);
      expect(result).toHaveLength(1);
    });

    it('should skip duplicate relations', async () => {
      await manager.createRelations([
        { from: 'auth', to: 'jwt', relationType: 'depends_on' },
      ]);
      const result = await manager.createRelations([
        { from: 'auth', to: 'jwt', relationType: 'depends_on' },
      ]);
      expect(result).toHaveLength(0);
    });
  });

  describe('addObservations', () => {
    it('should add observations to existing entities', async () => {
      await manager.createEntities([
        { name: 'port-config', entityType: 'config', observations: [] },
      ]);
      const result = await manager.addObservations([
        { entityName: 'port-config', contents: ['port 3001 because 3000 was taken'] },
      ]);
      expect(result[0].addedObservations).toHaveLength(1);
    });

    it('should throw for non-existent entity', async () => {
      await expect(
        manager.addObservations([
          { entityName: 'nonexistent', contents: ['test'] },
        ]),
      ).rejects.toThrow('Entity with name nonexistent not found');
    });

    it('should skip duplicate observations', async () => {
      await manager.createEntities([
        { name: 'config', entityType: 'config', observations: ['existing'] },
      ]);
      const result = await manager.addObservations([
        { entityName: 'config', contents: ['existing', 'new'] },
      ]);
      expect(result[0].addedObservations).toEqual(['new']);
    });
  });

  describe('deleteEntities', () => {
    it('should delete entities and cascade relations', async () => {
      await manager.createEntities([
        { name: 'a', entityType: 't', observations: [] },
        { name: 'b', entityType: 't', observations: [] },
      ]);
      await manager.createRelations([
        { from: 'a', to: 'b', relationType: 'uses' },
      ]);

      await manager.deleteEntities(['a']);
      const graph = await manager.readGraph();
      expect(graph.entities).toHaveLength(1);
      expect(graph.entities[0].name).toBe('b');
      expect(graph.relations).toHaveLength(0);
    });
  });

  describe('searchNodes', () => {
    it('should search by entity name', async () => {
      await manager.createEntities([
        { name: 'auth-module', entityType: 'component', observations: [] },
        { name: 'database', entityType: 'component', observations: [] },
      ]);
      const result = await manager.searchNodes('auth');
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('auth-module');
    });

    it('should search by observation content', async () => {
      await manager.createEntities([
        { name: 'config', entityType: 'config', observations: ['port 3001 conflict'] },
      ]);
      const result = await manager.searchNodes('3001');
      expect(result.entities).toHaveLength(1);
    });

    it('should include relations between matched entities', async () => {
      await manager.createEntities([
        { name: 'auth', entityType: 'module', observations: [] },
        { name: 'auth-jwt', entityType: 'lib', observations: [] },
        { name: 'database', entityType: 'module', observations: [] },
      ]);
      await manager.createRelations([
        { from: 'auth', to: 'auth-jwt', relationType: 'uses' },
        { from: 'auth', to: 'database', relationType: 'reads' },
      ]);

      const result = await manager.searchNodes('auth');
      expect(result.entities).toHaveLength(2); // auth, auth-jwt
      expect(result.relations).toHaveLength(1); // auth → auth-jwt
    });
  });

  describe('persistence', () => {
    it('should persist and reload graph across instances', async () => {
      await manager.createEntities([
        { name: 'test', entityType: 'module', observations: ['data'] },
      ]);
      await manager.createRelations([
        { from: 'test', to: 'test', relationType: 'self' },
      ]);

      // Create new manager on same dir
      const manager2 = new KnowledgeGraphManager(testDir);
      const graph = await manager2.readGraph();
      expect(graph.entities).toHaveLength(1);
      expect(graph.entities[0].name).toBe('test');
      expect(graph.entities[0].observations).toContain('data');
      expect(graph.relations).toHaveLength(1);
    });
  });
});
