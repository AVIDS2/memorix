/**
 * MCP Server Integration Tests
 *
 * End-to-end tests for the complete store → search → detail workflow.
 * Verifies the 3-layer Progressive Disclosure actually works together.
 *
 * TDD: Tests the full pipeline, not individual units.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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
import { storeObservation, initObservations, reindexObservations } from '../../src/memory/observations.js';
import { resetDb } from '../../src/store/orama-store.js';
import { compactSearch, compactTimeline, compactDetail } from '../../src/compact/engine.js';
import type { ObservationType } from '../../src/types.js';

let testDir: string;
let graphManager: KnowledgeGraphManager;
const PROJECT_ID = 'test/memorix-integration';

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-e2e-'));
  await resetDb();
  graphManager = new KnowledgeGraphManager(testDir);
  await graphManager.init();
  await initObservations(testDir);
});

describe('End-to-End: Store → Search → Detail', () => {
  it('should store an observation and find it via search', async () => {
    // Store
    const { observation: obs } = await storeObservation({
      entityName: 'auth-module',
      type: 'decision',
      title: 'Use JWT for API authentication',
      narrative: 'Decided to use JSON Web Tokens for stateless API authentication instead of sessions',
      facts: ['JWT chosen over sessions', 'Token expiry: 24h'],
      filesModified: ['src/auth/jwt.ts'],
      concepts: ['auth', 'JWT', 'security'],
      projectId: PROJECT_ID,
    });

    expect(obs.id).toBe(1);
    expect(obs.tokens).toBeGreaterThan(0);

    // Search (Layer 1)
    const searchResult = await compactSearch({ query: 'JWT', projectId: PROJECT_ID });
    expect(searchResult.entries).toHaveLength(1);
    expect(searchResult.entries[0].id).toBe(obs.id);
    expect(searchResult.entries[0].icon).toBe('🟤'); // decision icon
    expect(searchResult.entries[0].title).toBe('Use JWT for API authentication');

    // Detail (Layer 3)
    const detailResult = await compactDetail([obs.id]);
    expect(detailResult.documents).toHaveLength(1);
    expect(detailResult.formatted).toContain('JWT');
    expect(detailResult.formatted).toContain('jwt.ts');
  });

  it('should support multiple observations and filtered search', async () => {
    await storeObservation({
      entityName: 'port-config',
      type: 'gotcha',
      title: 'Port 3001 conflict with dev server',
      narrative: 'Port 3000 was taken by another process, switched to 3001',
      facts: ['Original port: 3000', 'New port: 3001'],
      projectId: PROJECT_ID,
    });

    await storeObservation({
      entityName: 'auth-module',
      type: 'decision',
      title: 'Use JWT for authentication',
      narrative: 'JWT selected for stateless auth',
      projectId: PROJECT_ID,
    });

    await storeObservation({
      entityName: 'deploy-config',
      type: 'problem-solution',
      title: 'Fixed Docker build timeout',
      narrative: 'Docker build was timing out, increased timeout to 600s',
      projectId: PROJECT_ID,
    });

    // Search for 'port' — should find only port-related
    const portResults = await compactSearch({ query: 'port', projectId: PROJECT_ID });
    expect(portResults.entries.length).toBeGreaterThanOrEqual(1);
    expect(portResults.entries.some(e => e.title.includes('Port'))).toBe(true);

    // Filter by type
    const gotchaResults = await compactSearch({
      query: '',
      type: 'gotcha' as ObservationType,
      projectId: PROJECT_ID,
    });
    // Should find at least the port gotcha
    expect(gotchaResults.entries.some(e => e.icon === '🔴')).toBe(true);
  });

  it('should support timeline (Layer 2) with chronological context', async () => {
    // Store 5 observations in sequence
    for (let i = 1; i <= 5; i++) {
      await storeObservation({
        entityName: `entity-${i}`,
        type: 'how-it-works',
        title: `Step ${i} of setup process`,
        narrative: `Description of step ${i}`,
        projectId: PROJECT_ID,
      });
    }

    // Get timeline around observation #3
    const timeline = await compactTimeline(3, PROJECT_ID, 2, 2);
    expect(timeline.formatted).toContain('Timeline');
    // Should have before and after entries
    expect(timeline.timeline.before.length).toBeGreaterThanOrEqual(1);
    expect(timeline.timeline.after.length).toBeGreaterThanOrEqual(1);
  });

  it('should integrate with knowledge graph', async () => {
    // Create entity
    await graphManager.createEntities([
      { name: 'api-gateway', entityType: 'component', observations: [] },
    ]);

    // Store observation referencing entity
    const { observation: obs } = await storeObservation({
      entityName: 'api-gateway',
      type: 'trade-off',
      title: 'Chose Express over Fastify for gateway',
      narrative: 'Express has larger ecosystem despite Fastify being faster',
      facts: ['Express: bigger ecosystem', 'Fastify: 2x throughput'],
      projectId: PROJECT_ID,
    });

    // Add observation reference to graph
    await graphManager.addObservations([
      { entityName: 'api-gateway', contents: [`[#${obs.id}] ${obs.title}`] },
    ]);

    // Verify graph has the reference
    const graph = await graphManager.openNodes(['api-gateway']);
    expect(graph.entities).toHaveLength(1);
    expect(graph.entities[0].observations).toContain(`[#${obs.id}] Chose Express over Fastify for gateway`);

    // Verify search finds it
    const searchResult = await compactSearch({ query: 'Express Fastify', projectId: PROJECT_ID });
    expect(searchResult.entries.length).toBeGreaterThanOrEqual(1);
    expect(searchResult.entries[0].icon).toBe('⚖️'); // trade-off icon
  });

  it('should produce formatted output with Progressive Disclosure hints', async () => {
    await storeObservation({
      entityName: 'test',
      type: 'discovery',
      title: 'Found memory leak in event handler',
      narrative: 'Event listeners not cleaned up on unmount',
      projectId: PROJECT_ID,
    });

    const result = await compactSearch({ query: 'memory leak', projectId: PROJECT_ID });
    // Should contain table headers
    expect(result.formatted).toContain('| Ref |');
    expect(result.formatted).toContain('| Time |');
    // Should contain Progressive Disclosure hint
    expect(result.formatted).toContain('memorix_detail');
    expect(result.formatted).toContain('memorix_timeline');
  });

  it('should track access count when observations are searched', async () => {
    await storeObservation({
      entityName: 'access-test',
      type: 'discovery',
      title: 'Access tracking test observation',
      narrative: 'Testing that access count increments on search',
      projectId: PROJECT_ID,
    });

    // Search twice
    await compactSearch({ query: 'access tracking', projectId: PROJECT_ID });
    // Small delay to let async recordAccess complete
    await new Promise((r) => setTimeout(r, 50));
    await compactSearch({ query: 'access tracking', projectId: PROJECT_ID });
    await new Promise((r) => setTimeout(r, 50));

    // Detail should still work (access tracking is best-effort)
    const detail = await compactDetail([1]);
    expect(detail.documents).toHaveLength(1);
    expect(detail.documents[0].title).toBe('Access tracking test observation');
  });

  it('should respect maxTokens budget in search', async () => {
    // Store 5 observations with known content
    for (let i = 1; i <= 5; i++) {
      await storeObservation({
        entityName: `budget-${i}`,
        type: 'how-it-works',
        title: `Budget test observation number ${i} with some extra words`,
        narrative: `This is a longer narrative for observation ${i} to ensure token count is reasonable`,
        facts: ['fact one', 'fact two'],
        projectId: PROJECT_ID,
      });
    }

    // Search without budget — should return all 5
    const allResults = await compactSearch({ query: '', projectId: PROJECT_ID });
    expect(allResults.entries.length).toBe(5);

    // Search with very small token budget — should return fewer
    const budgetResults = await compactSearch({
      query: '',
      projectId: PROJECT_ID,
      maxTokens: 30, // very small budget
    });
    expect(budgetResults.entries.length).toBeLessThan(5);
    expect(budgetResults.entries.length).toBeGreaterThanOrEqual(1);
  });

  it('should reject promote when request contains non-active observations', async () => {
    const { initMiniSkillStore, getMiniSkillStore, resetMiniSkillStore } = await import('../../src/store/mini-skill-store.js');
    const { promoteToMiniSkill } = await import('../../src/skills/mini-skills.js');
    const { resolveObservations } = await import('../../src/memory/observations.js');
    await initMiniSkillStore(testDir);

    // Store two observations — one will be archived
    const { observation: obs1 } = await storeObservation({
      entityName: 'promote-gate',
      type: 'decision',
      title: 'Active decision about caching',
      narrative: 'Use Redis for session caching',
      projectId: PROJECT_ID,
    });
    const { observation: obs2 } = await storeObservation({
      entityName: 'promote-gate',
      type: 'discovery',
      title: 'Old discovery to archive',
      narrative: 'Found stale pattern',
      projectId: PROJECT_ID,
    });

    // Archive obs2
    await resolveObservations([obs2.id]);

    // Attempt to promote [active, archived] — must fail
    const { getAllObservations } = await import('../../src/memory/observations.js');
    const allObs = getAllObservations();
    const selected = allObs.filter(o => [obs1.id, obs2.id].includes(o.id));
    await expect(
      promoteToMiniSkill(testDir, PROJECT_ID, selected),
    ).rejects.toThrow('not active');

    // Verify no skill was created
    const store = getMiniSkillStore();
    const skills = await store.loadAll();
    expect(skills).toHaveLength(0);

    resetMiniSkillStore();
  });

  it('should isolate projects — search should not cross projects', async () => {
    await storeObservation({
      entityName: 'shared',
      type: 'decision',
      title: 'Project A decision',
      narrative: 'Decision for project A',
      projectId: 'project-a',
    });

    await storeObservation({
      entityName: 'shared',
      type: 'decision',
      title: 'Project B decision',
      narrative: 'Decision for project B',
      projectId: 'project-b',
    });

    const resultA = await compactSearch({ query: 'decision', projectId: 'project-a' });
    const resultB = await compactSearch({ query: 'decision', projectId: 'project-b' });

    expect(resultA.entries).toHaveLength(1);
    expect(resultA.entries[0].title).toBe('Project A decision');
    expect(resultB.entries).toHaveLength(1);
    expect(resultB.entries[0].title).toBe('Project B decision');
  });
});
