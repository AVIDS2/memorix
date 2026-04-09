/**
 * Phase 4a: Observation Attribution + Project-Scoped Watermark Tests
 *
 * Fix #1: createdByAgentId flows through storeObservation write path
 * Fix #2: watermark counts are project-scoped (not global generation diff)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: async () => null,
  isVectorSearchAvailable: async () => false,
  isEmbeddingExplicitlyDisabled: () => true,
  resetProvider: () => {},
}));

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { storeObservation, initObservations, getAllObservations, ensureFreshObservations } from '../../src/memory/observations.js';
import { initObservationStore, getObservationStore } from '../../src/store/obs-store.js';
import { resetDb } from '../../src/store/orama-store.js';
import { TeamStore } from '../../src/team/team-store.js';
import { closeDatabase } from '../../src/store/sqlite-db.js';
import { withFreshIndex } from '../../src/memory/freshness.js';

let testDir: string;
const PROJECT_A = 'test/project-a';
const PROJECT_B = 'test/project-b';

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-attr-test-'));
  await resetDb();
  await initObservationStore(testDir);
  await initObservations(testDir);
});

afterEach(() => {
  closeDatabase(testDir);
  fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
});

// ═══════════════════════════════════════════════════════════════════
// Fix #1: createdByAgentId attribution
// ═══════════════════════════════════════════════════════════════════

describe('createdByAgentId attribution', () => {
  it('should store createdByAgentId on new observation when provided', async () => {
    const { observation } = await storeObservation({
      entityName: 'auth-module',
      type: 'decision',
      title: 'Use JWT for auth',
      narrative: 'Decided to use JWT tokens',
      projectId: PROJECT_A,
      createdByAgentId: 'agent_abc123',
      sourceDetail: 'explicit',
    });

    expect(observation.createdByAgentId).toBe('agent_abc123');
  });

  it('should persist createdByAgentId to SQLite and survive reload', async () => {
    await storeObservation({
      entityName: 'db-module',
      type: 'what-changed',
      title: 'Migrated to SQLite',
      narrative: 'Replaced JSON persistence with SQLite',
      projectId: PROJECT_A,
      createdByAgentId: 'agent_windsurf_01',
      sourceDetail: 'explicit',
    });

    // Reload from store
    const store = getObservationStore();
    const all = await store.loadAll();
    const obs = all.find(o => o.entityName === 'db-module');
    expect(obs).toBeDefined();
    expect(obs!.createdByAgentId).toBe('agent_windsurf_01');
  });

  it('should leave createdByAgentId undefined when not provided (backward compat)', async () => {
    const { observation } = await storeObservation({
      entityName: 'config',
      type: 'discovery',
      title: 'Found config issue',
      narrative: 'Config was missing a field',
      projectId: PROJECT_A,
      sourceDetail: 'explicit',
    });

    expect(observation.createdByAgentId).toBeUndefined();
  });

  it('should set writeGeneration on stored observation', async () => {
    const { observation } = await storeObservation({
      entityName: 'api-module',
      type: 'how-it-works',
      title: 'API rate limiting',
      narrative: 'Rate limiter uses sliding window',
      projectId: PROJECT_A,
      sourceDetail: 'explicit',
    });

    // writeGeneration should be set (> 0 for SQLite backend)
    expect(observation.writeGeneration).toBeDefined();
    expect(observation.writeGeneration).toBeGreaterThan(0);
  });

  it('should set different writeGeneration for sequential observations', async () => {
    const { observation: obs1 } = await storeObservation({
      entityName: 'module-a',
      type: 'decision',
      title: 'First decision',
      narrative: 'Some narrative',
      projectId: PROJECT_A,
      sourceDetail: 'explicit',
    });

    const { observation: obs2 } = await storeObservation({
      entityName: 'module-b',
      type: 'decision',
      title: 'Second decision',
      narrative: 'Another narrative',
      projectId: PROJECT_A,
      sourceDetail: 'explicit',
    });

    expect(obs2.writeGeneration).toBeGreaterThanOrEqual(obs1.writeGeneration!);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Fix #2: Project-scoped watermark
// ═══════════════════════════════════════════════════════════════════

describe('Project-scoped watermark', () => {
  it('should not count project B observations in project A watermark', async () => {
    // Store 2 observations in project A
    await storeObservation({
      entityName: 'module-a1',
      type: 'decision',
      title: 'Project A decision 1',
      narrative: 'Some narrative',
      projectId: PROJECT_A,
      sourceDetail: 'explicit',
    });
    await storeObservation({
      entityName: 'module-a2',
      type: 'decision',
      title: 'Project A decision 2',
      narrative: 'Some narrative',
      projectId: PROJECT_A,
      sourceDetail: 'explicit',
    });

    // Record watermark at this point (global generation)
    const store = getObservationStore();
    const watermarkAfterA = store.getGeneration();

    // Store 3 observations in project B
    await storeObservation({
      entityName: 'module-b1',
      type: 'discovery',
      title: 'Project B discovery 1',
      narrative: 'B narrative',
      projectId: PROJECT_B,
      sourceDetail: 'explicit',
    });
    await storeObservation({
      entityName: 'module-b2',
      type: 'discovery',
      title: 'Project B discovery 2',
      narrative: 'B narrative',
      projectId: PROJECT_B,
      sourceDetail: 'explicit',
    });
    await storeObservation({
      entityName: 'module-b3',
      type: 'discovery',
      title: 'Project B discovery 3',
      narrative: 'B narrative',
      projectId: PROJECT_B,
      sourceDetail: 'explicit',
    });

    // Project-scoped watermark for project A:
    // Count observations where projectId=A AND writeGeneration > watermarkAfterA
    const allObs = getAllObservations();
    const newInA = allObs.filter(
      o => o.projectId === PROJECT_A && (o.writeGeneration ?? 0) > watermarkAfterA,
    );
    const newInB = allObs.filter(
      o => o.projectId === PROJECT_B && (o.writeGeneration ?? 0) > watermarkAfterA,
    );

    // Project A should have 0 new observations (nothing written after watermark)
    expect(newInA.length).toBe(0);
    // Project B should have 3 new observations
    expect(newInB.length).toBe(3);

    // Global generation diff would incorrectly show 3 for project A too
    const globalGen = store.getGeneration();
    const globalDiff = globalGen - watermarkAfterA;
    expect(globalDiff).toBeGreaterThan(0); // Global says "new stuff"
    // But project-scoped correctly says 0 for project A
    expect(newInA.length).toBe(0);
  });

  it('should count new same-project observations in watermark', async () => {
    // Record watermark BEFORE any writes
    const store = getObservationStore();
    const initialGen = store.getGeneration();

    // Store observations in project A
    await storeObservation({
      entityName: 'new-module',
      type: 'what-changed',
      title: 'Added new module',
      narrative: 'Created a new module',
      projectId: PROJECT_A,
      sourceDetail: 'explicit',
      createdByAgentId: 'agent_cursor_01',
    });
    await storeObservation({
      entityName: 'new-module-2',
      type: 'what-changed',
      title: 'Added another module',
      narrative: 'Created another module',
      projectId: PROJECT_A,
      sourceDetail: 'explicit',
      createdByAgentId: 'agent_cursor_01',
    });

    // Project-scoped watermark: should show 2 new in project A
    const allObs = getAllObservations();
    const newInA = allObs.filter(
      o => o.projectId === PROJECT_A && (o.writeGeneration ?? 0) > initialGen,
    );
    expect(newInA.length).toBe(2);
    // Both should have agent attribution
    expect(newInA.every(o => o.createdByAgentId === 'agent_cursor_01')).toBe(true);
  });

  it('should not inherit stale agent identity after re-start without agent (sticky attribution prevention)', async () => {
    // Simulate the server's currentAgentId lifecycle:
    // session_start #1: register agent → currentAgentId set
    // session_start #2: no agent → currentAgentId cleared
    // subsequent store → no createdByAgentId

    let currentAgentId: string | undefined;

    // Session 1: register agent A
    const teamStore = new TeamStore();
    await teamStore.init(testDir);
    currentAgentId = undefined; // clear at start (server.ts line)
    const agentA = teamStore.registerAgent({
      projectId: PROJECT_A,
      agentType: 'windsurf',
      instanceId: 'inst-01',
      name: 'Cascade',
    });
    currentAgentId = agentA.agent_id; // set after successful registration

    // Store observation — should have agent A
    const { observation: obs1 } = await storeObservation({
      entityName: 'module-1',
      type: 'decision',
      title: 'First session store',
      narrative: 'With agent A',
      projectId: PROJECT_A,
      sourceDetail: 'explicit',
      createdByAgentId: currentAgentId,
    });
    expect(obs1.createdByAgentId).toBe(agentA.agent_id);

    // Session 2: no agent/agentType provided — currentAgentId cleared, not re-set
    currentAgentId = undefined; // server.ts clears at start of session_start
    // (no registerAgent call because no agent/agentType was provided)

    // Store observation — should NOT inherit agent A
    const { observation: obs2 } = await storeObservation({
      entityName: 'module-2',
      type: 'discovery',
      title: 'Second session store',
      narrative: 'Without agent',
      projectId: PROJECT_A,
      sourceDetail: 'explicit',
      createdByAgentId: currentAgentId, // undefined
    });
    expect(obs2.createdByAgentId).toBeUndefined();

    // Verify in SQLite as well
    const store = getObservationStore();
    const all = await store.loadAll();
    const persisted1 = all.find(o => o.entityName === 'module-1');
    const persisted2 = all.find(o => o.entityName === 'module-2');
    expect(persisted1!.createdByAgentId).toBe(agentA.agent_id);
    expect(persisted2!.createdByAgentId).toBeFalsy(); // null or undefined
  });

  it('should read watermark through withFreshIndex (not bare getAllObservations)', async () => {
    // Spy on ensureFreshObservations to prove the watermark path calls it
    const freshSpy = vi.spyOn(
      await import('../../src/memory/observations.js'),
      'ensureFreshObservations',
    );

    // Store an observation so there is something to count
    await storeObservation({
      entityName: 'fresh-module',
      type: 'decision',
      title: 'Freshness test',
      narrative: 'Testing freshness gate',
      projectId: PROJECT_A,
      sourceDetail: 'explicit',
    });

    freshSpy.mockClear();

    // Simulate the watermark read pattern from server.ts:
    // await withFreshIndex(() => getAllObservations().filter(...))
    const lastSeen = 0;
    const projectObs = await withFreshIndex(() =>
      getAllObservations().filter(
        o => o.projectId === PROJECT_A && (o.writeGeneration ?? 0) > lastSeen,
      ),
    );

    // withFreshIndex calls ensureFreshObservations under the hood
    expect(freshSpy).toHaveBeenCalled();
    expect(projectObs.length).toBe(1);

    freshSpy.mockRestore();
  });

  it('should integrate with TeamStore agent watermark lifecycle', async () => {
    // Initialize TeamStore
    const teamStore = new TeamStore();
    await teamStore.init(testDir);

    // Register agent in project A
    const agent = teamStore.registerAgent({
      projectId: PROJECT_A,
      agentType: 'windsurf',
      instanceId: 'inst-01',
      name: 'Cascade',
    });
    expect(agent.last_seen_obs_generation).toBe(0);

    // Store observations for project A and B
    await storeObservation({
      entityName: 'a-module',
      type: 'decision',
      title: 'A decision',
      narrative: 'Narrative',
      projectId: PROJECT_A,
      sourceDetail: 'explicit',
      createdByAgentId: agent.agent_id,
    });
    await storeObservation({
      entityName: 'b-module',
      type: 'decision',
      title: 'B decision',
      narrative: 'Narrative',
      projectId: PROJECT_B,
      sourceDetail: 'explicit',
    });

    // Simulate session_start watermark check (project-scoped)
    const lastSeen = agent.last_seen_obs_generation; // 0
    const allObs = getAllObservations();
    const newForProjectA = allObs.filter(
      o => o.projectId === PROJECT_A && (o.writeGeneration ?? 0) > lastSeen,
    );

    // Should see exactly 1 new observation in project A (not the project B one)
    expect(newForProjectA.length).toBe(1);
    expect(newForProjectA[0].createdByAgentId).toBe(agent.agent_id);

    // Update watermark
    const store = getObservationStore();
    teamStore.updateWatermark(agent.agent_id, store.getGeneration());

    // Re-read agent to verify watermark advanced
    const updatedAgent = teamStore.getAgent(agent.agent_id);
    expect(updatedAgent!.last_seen_obs_generation).toBeGreaterThan(0);

    // No new observations since watermark update
    const newAfterUpdate = allObs.filter(
      o => o.projectId === PROJECT_A && (o.writeGeneration ?? 0) > updatedAgent!.last_seen_obs_generation,
    );
    expect(newAfterUpdate.length).toBe(0);
  });
});
