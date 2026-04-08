/**
 * Freshness Gate Tests (Phase 3a hardening)
 *
 * Tests for:
 * - Fix 3: ensureFreshMiniSkills diagnostic logging on failure
 * - Fix 4: reindexMiniSkills deterministic doc ID tracking (no empty-term search)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: async () => null,
  isVectorSearchAvailable: async () => false,
  isEmbeddingExplicitlyDisabled: () => true,
  resetProvider: () => {},
}));

import { ensureFreshMiniSkills, reindexMiniSkills, resetMiniSkillFreshness } from '../../src/memory/freshness.js';
import { initObservations, storeObservation } from '../../src/memory/observations.js';
import { resetDb } from '../../src/store/orama-store.js';
import { initAliasRegistry, resetAliasCache } from '../../src/project/aliases.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-freshness-'));
  await resetDb();
  resetAliasCache();
  resetMiniSkillFreshness();
  initAliasRegistry(testDir);
  await initObservations(testDir);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ensureFreshMiniSkills diagnostic logging (Fix 3)', () => {
  it('should skip silently when mini-skill store is not initialized (no warn)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Don't initialize mini-skill store — observation-only path
    const result = await ensureFreshMiniSkills();
    expect(result).toBe(false);
    // Must NOT produce noise logs on observation-only paths
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('should warn on real freshness failure when store IS initialized', async () => {
    const { initMiniSkillStore, getMiniSkillStore, resetMiniSkillStore } = await import('../../src/store/mini-skill-store.js');
    await initMiniSkillStore(testDir);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Sabotage ensureFresh to simulate a real failure
    const store = getMiniSkillStore();
    vi.spyOn(store, 'ensureFresh').mockRejectedValueOnce(new Error('disk I/O error'));

    try {
      const result = await ensureFreshMiniSkills();
      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0][0]).toContain('[memorix] ensureFreshMiniSkills failed');
      expect(warnSpy.mock.calls[0][0]).toContain('disk I/O error');
    } finally {
      resetMiniSkillStore();
      const { closeAllDatabases } = await import('../../src/store/sqlite-db.js');
      closeAllDatabases();
    }
  });

  it('should not crash the read path on failure', async () => {
    const { initMiniSkillStore, getMiniSkillStore, resetMiniSkillStore } = await import('../../src/store/mini-skill-store.js');
    await initMiniSkillStore(testDir);

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = getMiniSkillStore();
    vi.spyOn(store, 'ensureFresh').mockRejectedValueOnce(new Error('transient'));

    try {
      // Should return false gracefully, not throw
      const result = await ensureFreshMiniSkills();
      expect(result).toBe(false);
    } finally {
      resetMiniSkillStore();
      const { closeAllDatabases } = await import('../../src/store/sqlite-db.js');
      closeAllDatabases();
    }
  });
});

describe('reindexMiniSkills deterministic cleanup (Fix 4)', () => {
  it('should reindex mini-skills without empty-term search', async () => {
    const { initMiniSkillStore, resetMiniSkillStore } = await import('../../src/store/mini-skill-store.js');
    const { promoteToMiniSkill } = await import('../../src/skills/mini-skills.js');
    await initMiniSkillStore(testDir);

    try {
      const { observation: obs } = await storeObservation({
        entityName: 'reindex-test',
        type: 'decision',
        title: 'Reindex deterministic test',
        narrative: 'Testing deterministic reindex without empty-term search',
        facts: ['Fact A'],
        projectId: 'test/project',
      });

      await promoteToMiniSkill(testDir, 'test/project', [obs]);

      // First reindex — should insert
      const count1 = await reindexMiniSkills();
      expect(count1).toBe(1);

      // Second reindex — should remove old doc by tracked ID, then re-insert
      const count2 = await reindexMiniSkills();
      expect(count2).toBe(1);

      // Verify the skill is searchable after reindex
      const { search } = await import('@orama/orama');
      const { getDb } = await import('../../src/store/orama-store.js');
      const database = await getDb();
      const results = await search(database, {
        term: 'Reindex deterministic test',
        where: { documentType: 'mini-skill' },
        limit: 10,
      });
      expect(results.hits).toHaveLength(1);
    } finally {
      resetMiniSkillStore();
      const { closeAllDatabases } = await import('../../src/store/sqlite-db.js');
      closeAllDatabases();
    }
  });

  it('should not leave stale docs after skill deletion + reindex', async () => {
    const { initMiniSkillStore, getMiniSkillStore, resetMiniSkillStore } = await import('../../src/store/mini-skill-store.js');
    const { promoteToMiniSkill } = await import('../../src/skills/mini-skills.js');
    await initMiniSkillStore(testDir);

    try {
      const { observation: obs } = await storeObservation({
        entityName: 'stale-cleanup',
        type: 'decision',
        title: 'Stale cleanup test',
        narrative: 'This skill will be indexed then deleted',
        facts: ['Stale fact'],
        projectId: 'test/project',
      });

      const skill = await promoteToMiniSkill(testDir, 'test/project', [obs]);

      // Index the skill
      const count1 = await reindexMiniSkills();
      expect(count1).toBe(1);

      // Delete the skill from the store
      const store = getMiniSkillStore();
      await store.remove(skill.id);

      // Reindex — should remove the old tracked doc and insert nothing
      const count2 = await reindexMiniSkills();
      expect(count2).toBe(0);

      // Verify no mini-skill docs remain in the index
      const { search } = await import('@orama/orama');
      const { getDb } = await import('../../src/store/orama-store.js');
      const database = await getDb();
      const results = await search(database, {
        term: '',
        where: { documentType: 'mini-skill' },
        limit: 100,
      });
      expect(results.hits).toHaveLength(0);
    } finally {
      resetMiniSkillStore();
      const { closeAllDatabases } = await import('../../src/store/sqlite-db.js');
      closeAllDatabases();
    }
  });
});
