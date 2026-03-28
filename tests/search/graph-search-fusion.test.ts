/**
 * Graph Search Fusion Tests
 *
 * Tests the integration of knowledge graph BFS traversal with
 * Orama search results via Reciprocal Rank Fusion (RRF).
 *
 * Covers:
 * - graphSearch() BFS traversal in KnowledgeGraphManager
 * - setGraphManager() injection into orama-store
 * - RRF merge of Orama + graph results in searchObservations()
 * - Fast-tier queries skip graph search entirely
 * - Graceful degradation when no graph manager is set
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock embedding provider BEFORE any imports that might use it
vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: async () => null,
  isVectorSearchAvailable: async () => false,
  isEmbeddingExplicitlyDisabled: () => true,
  resetProvider: () => {},
}));

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { KnowledgeGraphManager } from '../../src/memory/graph.js';
import { initObservations, storeObservation } from '../../src/memory/observations.js';
import {
  resetDb,
  setGraphManager,
  searchObservations,
  getLastSearchMode,
} from '../../src/store/orama-store.js';
import type { Entity, Relation } from '../../src/types.js';

let testDir: string;
let graphManager: KnowledgeGraphManager;
const PROJECT_ID = 'test/graph-search-fusion';

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-graph-fusion-'));
  await resetDb();
  graphManager = new KnowledgeGraphManager(testDir);
  await graphManager.init();
  setGraphManager(graphManager);
  await initObservations(testDir);
});

// ─── graphSearch() BFS Traversal ──────────────────────────────────────────────

describe('KnowledgeGraphManager.graphSearch()', () => {
  it('returns empty array when seed names are empty', async () => {
    const result = await graphManager.graphSearch([]);
    expect(result).toEqual([]);
  });

  it('returns empty array when seeds have no relations', async () => {
    await graphManager.createEntities([
      { name: 'isolated-node', entityType: 'component', observations: [] },
    ]);
    const result = await graphManager.graphSearch(['isolated-node']);
    expect(result).toEqual([]);
  });

  it('discovers 1-hop neighbors through relations', async () => {
    await graphManager.createEntities([
      { name: 'auth-module', entityType: 'component', observations: [] },
      { name: 'jwt-library', entityType: 'library', observations: [] },
      { name: 'user-service', entityType: 'service', observations: [] },
    ]);
    await graphManager.createRelations([
      { from: 'auth-module', to: 'jwt-library', relationType: 'depends_on' },
      { from: 'auth-module', to: 'user-service', relationType: 'implements' },
    ]);

    const result = await graphManager.graphSearch(['auth-module']);
    const names = result.map(r => r.entityName);

    expect(names).toContain('jwt-library');
    expect(names).toContain('user-service');
    expect(names).not.toContain('auth-module'); // seed excluded from discovered
    expect(result.every(r => r.hopDistance === 1)).toBe(true);
  });

  it('discovers 2-hop neighbors', async () => {
    await graphManager.createEntities([
      { name: 'A', entityType: 'component', observations: [] },
      { name: 'B', entityType: 'component', observations: [] },
      { name: 'C', entityType: 'component', observations: [] },
    ]);
    await graphManager.createRelations([
      { from: 'A', to: 'B', relationType: 'depends_on' },
      { from: 'B', to: 'C', relationType: 'depends_on' },
    ]);

    const result = await graphManager.graphSearch(['A'], 2);

    const bResult = result.find(r => r.entityName === 'B');
    const cResult = result.find(r => r.entityName === 'C');

    expect(bResult).toBeDefined();
    expect(bResult!.hopDistance).toBe(1);
    expect(cResult).toBeDefined();
    expect(cResult!.hopDistance).toBe(2);
  });

  it('respects maxHops=1 and does not discover 2-hop neighbors', async () => {
    await graphManager.createEntities([
      { name: 'A', entityType: 'component', observations: [] },
      { name: 'B', entityType: 'component', observations: [] },
      { name: 'C', entityType: 'component', observations: [] },
    ]);
    await graphManager.createRelations([
      { from: 'A', to: 'B', relationType: 'depends_on' },
      { from: 'B', to: 'C', relationType: 'depends_on' },
    ]);

    const result = await graphManager.graphSearch(['A'], 1);
    const names = result.map(r => r.entityName);

    expect(names).toContain('B');
    expect(names).not.toContain('C');
  });

  it('traverses relations bidirectionally', async () => {
    await graphManager.createEntities([
      { name: 'X', entityType: 'component', observations: [] },
      { name: 'Y', entityType: 'component', observations: [] },
    ]);
    // Relation goes X → Y, but searching from Y should find X
    await graphManager.createRelations([
      { from: 'X', to: 'Y', relationType: 'causes' },
    ]);

    const result = await graphManager.graphSearch(['Y']);
    expect(result.map(r => r.entityName)).toContain('X');
  });

  it('does not revisit already-visited nodes (cycle safety)', async () => {
    await graphManager.createEntities([
      { name: 'A', entityType: 'component', observations: [] },
      { name: 'B', entityType: 'component', observations: [] },
      { name: 'C', entityType: 'component', observations: [] },
    ]);
    // Create a cycle: A → B → C → A
    await graphManager.createRelations([
      { from: 'A', to: 'B', relationType: 'depends_on' },
      { from: 'B', to: 'C', relationType: 'depends_on' },
      { from: 'C', to: 'A', relationType: 'depends_on' },
    ]);

    const result = await graphManager.graphSearch(['A'], 10);
    // Should discover B and C but not re-add A
    const names = result.map(r => r.entityName);
    expect(names).toContain('B');
    expect(names).toContain('C');
    expect(names).not.toContain('A');
    // No duplicates
    expect(new Set(names).size).toBe(names.length);
  });

  it('handles case-insensitive seed names', async () => {
    await graphManager.createEntities([
      { name: 'AuthModule', entityType: 'component', observations: [] },
      { name: 'JwtLib', entityType: 'library', observations: [] },
    ]);
    await graphManager.createRelations([
      { from: 'AuthModule', to: 'JwtLib', relationType: 'depends_on' },
    ]);

    const result = await graphManager.graphSearch(['authmodule']); // lowercase
    expect(result.map(r => r.entityName)).toContain('JwtLib');
  });

  it('handles seeds that do not exist in the graph', async () => {
    await graphManager.createEntities([
      { name: 'real-entity', entityType: 'component', observations: [] },
    ]);

    const result = await graphManager.graphSearch(['nonexistent-entity']);
    expect(result).toEqual([]);
  });

  it('handles multiple seeds', async () => {
    await graphManager.createEntities([
      { name: 'A', entityType: 'component', observations: [] },
      { name: 'B', entityType: 'component', observations: [] },
      { name: 'C', entityType: 'component', observations: [] },
      { name: 'D', entityType: 'component', observations: [] },
    ]);
    await graphManager.createRelations([
      { from: 'A', to: 'C', relationType: 'depends_on' },
      { from: 'B', to: 'D', relationType: 'depends_on' },
    ]);

    const result = await graphManager.graphSearch(['A', 'B'], 1);
    const names = result.map(r => r.entityName);
    expect(names).toContain('C');
    expect(names).toContain('D');
  });
});

// ─── getEntitiesForNames() ────────────────────────────────────────────────────

describe('KnowledgeGraphManager.getEntitiesForNames()', () => {
  it('returns entities matching given names (case-insensitive)', async () => {
    await graphManager.createEntities([
      { name: 'Auth', entityType: 'component', observations: ['obs1'] },
      { name: 'Database', entityType: 'service', observations: [] },
    ]);

    const entities = graphManager.getEntitiesForNames(['auth', 'Database']);
    expect(entities.length).toBe(2);
    expect(entities.map(e => e.name).sort()).toEqual(['Auth', 'Database']);
  });

  it('skips names not found in graph', async () => {
    await graphManager.createEntities([
      { name: 'Existing', entityType: 'component', observations: [] },
    ]);

    const entities = graphManager.getEntitiesForNames(['Existing', 'missing']);
    expect(entities.length).toBe(1);
    expect(entities[0].name).toBe('Existing');
  });
});

// ─── setGraphManager() injection ──────────────────────────────────────────────

describe('setGraphManager()', () => {
  it('accepts null without errors', () => {
    expect(() => setGraphManager(null)).not.toThrow();
  });

  it('accepts KnowledgeGraphManager instance', () => {
    expect(() => setGraphManager(graphManager)).not.toThrow();
  });
});

// ─── Graph Search Fusion in searchObservations() ──────────────────────────────

describe('searchObservations() with graph fusion', () => {
  async function seedGraphAndObservations() {
    // Create entities with graph relations:
    // auth-module → jwt-library → crypto-utils
    await graphManager.createEntities([
      { name: 'auth-module', entityType: 'component', observations: [] },
      { name: 'jwt-library', entityType: 'library', observations: [] },
      { name: 'crypto-utils', entityType: 'utility', observations: [] },
      { name: 'unrelated-module', entityType: 'component', observations: [] },
    ]);
    await graphManager.createRelations([
      { from: 'auth-module', to: 'jwt-library', relationType: 'depends_on' },
      { from: 'jwt-library', to: 'crypto-utils', relationType: 'depends_on' },
    ]);

    // Store observations — auth-module directly matches "authentication",
    // jwt-library and crypto-utils only reachable via graph
    await storeObservation({
      entityName: 'auth-module',
      type: 'how-it-works',
      title: 'Authentication flow uses OAuth tokens',
      narrative: 'The auth-module handles OAuth 2.0 token validation and refresh',
      projectId: PROJECT_ID,
    });

    await storeObservation({
      entityName: 'jwt-library',
      type: 'decision',
      title: 'JWT signing algorithm choice',
      narrative: 'Selected RS256 for JWT signing to support public key verification',
      projectId: PROJECT_ID,
    });

    await storeObservation({
      entityName: 'crypto-utils',
      type: 'gotcha',
      title: 'Crypto key rotation schedule',
      narrative: 'Keys must be rotated every 90 days for compliance',
      projectId: PROJECT_ID,
    });

    await storeObservation({
      entityName: 'unrelated-module',
      type: 'discovery',
      title: 'Database connection pooling settings',
      narrative: 'The database uses a pool of 10 connections by default',
      projectId: PROJECT_ID,
    });
  }

  it('standard tier query triggers graph fusion and enriches results', async () => {
    await seedGraphAndObservations();

    // Query matches auth-module by text; graph should pull in jwt-library, crypto-utils
    const results = await searchObservations({
      query: 'authentication OAuth tokens flow',
      projectId: PROJECT_ID,
      limit: 20,
    });

    // Should include auth-module hit from Orama directly
    expect(results.some(r => r.title.includes('Authentication flow'))).toBe(true);

    // Graph fusion should pull in jwt-library observation (1 hop from auth-module)
    const jwtHit = results.find(r => r.title.includes('JWT signing'));
    expect(jwtHit).toBeDefined();

    // Search mode should indicate graph-rrf was used
    const mode = getLastSearchMode(PROJECT_ID);
    expect(mode).toContain('graph-rrf');
  });

  it('fast tier query skips graph search', async () => {
    await seedGraphAndObservations();

    // Single-word short query = fast tier → no graph search
    const results = await searchObservations({
      query: 'auth',
      projectId: PROJECT_ID,
      limit: 20,
    });

    const mode = getLastSearchMode(PROJECT_ID);
    expect(mode).not.toContain('graph-rrf');
  });

  it('gracefully handles no graph manager set', async () => {
    setGraphManager(null); // Remove graph manager
    await seedGraphAndObservations();

    // Should still work — just no graph fusion
    const results = await searchObservations({
      query: 'authentication OAuth tokens flow',
      projectId: PROJECT_ID,
      limit: 20,
    });

    expect(results.length).toBeGreaterThan(0);
    const mode = getLastSearchMode(PROJECT_ID);
    expect(mode).not.toContain('graph-rrf');
  });

  it('unrelated observations are not pulled in by graph traversal', async () => {
    await seedGraphAndObservations();

    const results = await searchObservations({
      query: 'authentication OAuth tokens flow',
      projectId: PROJECT_ID,
      limit: 20,
    });

    // "Database connection pooling" is unrelated — no graph path from auth-module
    // It should only appear if BM25/vector matched it (unlikely for this query)
    const dbHit = results.find(r => r.title.includes('Database connection pooling'));
    // If it appears at all, it should be ranked lower than auth results
    if (dbHit) {
      const authIdx = results.findIndex(r => r.title.includes('Authentication flow'));
      const dbIdx = results.indexOf(dbHit);
      expect(dbIdx).toBeGreaterThan(authIdx);
    }
  });
});
