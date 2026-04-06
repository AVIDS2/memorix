/**
 * Concurrency atomicity regression tests
 *
 * PR #60 review findings:
 * 1. Concurrent promoteToMiniSkill must not produce duplicate IDs or overwrite skills
 * 2. Concurrent startSession must leave exactly one active session per project
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initMiniSkillStore, getMiniSkillStore, resetMiniSkillStore } from '../../src/store/mini-skill-store.js';
import { initSessionStore, getSessionStore, resetSessionStore } from '../../src/store/session-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import type { Observation } from '../../src/types.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-atomicity-'));
  resetMiniSkillStore();
  resetSessionStore();
});

afterEach(async () => {
  resetMiniSkillStore();
  resetSessionStore();
  closeAllDatabases();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Fix 1: Mini-skill atomic ID allocation ──────────────────────────

describe('Concurrent promoteToMiniSkill — atomic ID allocation', () => {
  it('should assign unique IDs when N promotes run concurrently', async () => {
    await initMiniSkillStore(tmpDir);
    const store = getMiniSkillStore();

    const N = 20;
    const promises = Array.from({ length: N }, (_, i) =>
      store.atomicInsertWithId({
        sourceObservationIds: [i + 1],
        sourceEntity: `entity-${i}`,
        title: `Skill ${i}`,
        instruction: `Do thing ${i}`,
        trigger: `When thing ${i}`,
        facts: [`fact-${i}`],
        projectId: 'org/test-project',
        createdAt: new Date().toISOString(),
        usedCount: 0,
        tags: [`tag-${i}`],
      }),
    );

    const skills = await Promise.all(promises);

    // All IDs must be unique
    const ids = skills.map(s => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(N);

    // All skills must be persisted (no overwrites)
    const allSkills = await store.loadAll();
    expect(allSkills).toHaveLength(N);

    // Counter must be at N+1 (started at 1)
    const nextId = await store.loadIdCounter();
    expect(nextId).toBe(N + 1);
  });

  it('should not overwrite earlier skill when two promotes race', async () => {
    await initMiniSkillStore(tmpDir);
    const store = getMiniSkillStore();

    // Two concurrent promotes
    const [skillA, skillB] = await Promise.all([
      store.atomicInsertWithId({
        sourceObservationIds: [100],
        sourceEntity: 'auth-module',
        title: 'Auth gotcha',
        instruction: 'Avoid auth pitfall',
        trigger: 'Working on auth',
        facts: ['Token expires silently'],
        projectId: 'org/test',
        createdAt: new Date().toISOString(),
        usedCount: 0,
        tags: ['gotcha'],
      }),
      store.atomicInsertWithId({
        sourceObservationIds: [200],
        sourceEntity: 'billing-service',
        title: 'Billing decision',
        instruction: 'Use Stripe',
        trigger: 'Working on billing',
        facts: ['Stripe webhook retries'],
        projectId: 'org/test',
        createdAt: new Date().toISOString(),
        usedCount: 0,
        tags: ['decision'],
      }),
    ]);

    // Different IDs
    expect(skillA.id).not.toBe(skillB.id);

    // Both persisted with correct content
    const all = await store.loadAll();
    expect(all).toHaveLength(2);

    const authSkill = all.find(s => s.title === 'Auth gotcha');
    const billingSkill = all.find(s => s.title === 'Billing decision');
    expect(authSkill).toBeDefined();
    expect(billingSkill).toBeDefined();
    expect(authSkill!.sourceObservationIds).toEqual([100]);
    expect(billingSkill!.sourceObservationIds).toEqual([200]);
  });
});

// ── Fix 2: Session atomic rollover ──────────────────────────────────

describe('Concurrent startSession — atomic rollover', () => {
  it('should leave exactly one active session after N concurrent starts', async () => {
    await initSessionStore(tmpDir);
    const store = getSessionStore();

    const PROJECT_ID = 'org/concurrent-test';
    const N = 10;

    const promises = Array.from({ length: N }, (_, i) => {
      const session = {
        id: `sess-concurrent-${i}`,
        projectId: PROJECT_ID,
        startedAt: new Date().toISOString(),
        status: 'active' as const,
        agent: `agent-${i}`,
      };
      return store.atomicRolloverInsert(
        session,
        [PROJECT_ID],
        new Date().toISOString(),
      );
    });

    await Promise.all(promises);

    // Exactly one active session must remain
    const activeSessions = await store.loadActive(PROJECT_ID);
    expect(activeSessions).toHaveLength(1);

    // All N sessions should exist (N-1 completed + 1 active)
    const allSessions = await store.loadByProject(PROJECT_ID);
    expect(allSessions).toHaveLength(N);

    const activeCount = allSessions.filter(s => s.status === 'active').length;
    const completedCount = allSessions.filter(s => s.status === 'completed').length;
    expect(activeCount).toBe(1);
    expect(completedCount).toBe(N - 1);
  });

  it('should not affect sessions in other projects', async () => {
    await initSessionStore(tmpDir);
    const store = getSessionStore();

    const PROJECT_A = 'org/project-a';
    const PROJECT_B = 'org/project-b';

    // Insert an active session for project B
    await store.insert({
      id: 'sess-b-existing',
      projectId: PROJECT_B,
      startedAt: new Date().toISOString(),
      status: 'active',
      agent: 'windsurf',
    });

    // Concurrent starts for project A only
    const promises = Array.from({ length: 5 }, (_, i) => {
      const session = {
        id: `sess-a-${i}`,
        projectId: PROJECT_A,
        startedAt: new Date().toISOString(),
        status: 'active' as const,
        agent: `agent-${i}`,
      };
      return store.atomicRolloverInsert(session, [PROJECT_A], new Date().toISOString());
    });

    await Promise.all(promises);

    // Project A: exactly 1 active
    const activeA = await store.loadActive(PROJECT_A);
    expect(activeA).toHaveLength(1);

    // Project B: still 1 active, untouched
    const activeB = await store.loadActive(PROJECT_B);
    expect(activeB).toHaveLength(1);
    expect(activeB[0].id).toBe('sess-b-existing');
  });

  it('should handle project aliases in rollover', async () => {
    await initSessionStore(tmpDir);
    const store = getSessionStore();

    const ALIAS_1 = 'org/project-main';
    const ALIAS_2 = 'org/project-fork';

    // Insert active sessions under both aliases
    await store.insert({
      id: 'sess-alias-1',
      projectId: ALIAS_1,
      startedAt: new Date().toISOString(),
      status: 'active',
    });
    await store.insert({
      id: 'sess-alias-2',
      projectId: ALIAS_2,
      startedAt: new Date().toISOString(),
      status: 'active',
    });

    // Rollover with both aliases
    const newSession = {
      id: 'sess-new',
      projectId: ALIAS_1,
      startedAt: new Date().toISOString(),
      status: 'active' as const,
      agent: 'cursor',
    };
    const completed = await store.atomicRolloverInsert(
      newSession,
      [ALIAS_1, ALIAS_2],
      new Date().toISOString(),
    );

    expect(completed).toBe(2); // Both old sessions completed

    // Only the new session should be active
    const activeMain = await store.loadActive(ALIAS_1);
    expect(activeMain).toHaveLength(1);
    expect(activeMain[0].id).toBe('sess-new');

    // The alias-2 session should be completed
    const activeFork = await store.loadActive(ALIAS_2);
    expect(activeFork).toHaveLength(0);
  });
});
