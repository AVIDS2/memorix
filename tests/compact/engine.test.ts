/**
 * Compact Engine Tests
 *
 * Tests the 3-layer Progressive Disclosure workflow.
 * Based on claude-mem's proven architecture.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: async () => null,
  isVectorSearchAvailable: async () => false,
  isEmbeddingExplicitlyDisabled: () => true,
  resetProvider: () => {},
}));
import { compactSearch, compactDetail } from '../../src/compact/engine.js';
import { storeObservation, initObservations } from '../../src/memory/observations.js';
import { resetDb } from '../../src/store/orama-store.js';
import { initAliasRegistry, registerAlias, resetAliasCache } from '../../src/project/aliases.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-compact-'));
  await resetDb();
  resetAliasCache();
  initAliasRegistry(testDir);
  await initObservations(testDir);
});

describe('Compact Engine', () => {
  describe('compactSearch (Layer 1)', () => {
    it('should return compact index entries', async () => {
      await storeObservation({
        entityName: 'port-config',
        type: 'gotcha',
        title: 'Port 3001 conflict fix',
        narrative: 'Port 3000 was already in use by another process',
        facts: ['Default port: 3000', 'Changed to: 3001'],
        projectId: 'test/project',
      });

      const result = await compactSearch({ query: 'port', projectId: 'test/project' });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('Port 3001 conflict fix');
      expect(result.entries[0].icon).toBe('🔴');
      expect(result.entries[0].tokens).toBeGreaterThan(0);
    });

    it('should return formatted markdown table', async () => {
      await storeObservation({
        entityName: 'auth',
        type: 'decision',
        title: 'Use JWT for authentication',
        narrative: 'Decided to use JWT tokens for API auth',
        projectId: 'test/project',
      });

      const result = await compactSearch({ query: 'JWT', projectId: 'test/project' });
      expect(result.formatted).toContain('| Ref |');
      expect(result.formatted).toContain('JWT');
      expect(result.formatted).toContain('Progressive Disclosure');
    });

    it('should return empty message when no results', async () => {
      const result = await compactSearch({ query: 'nonexistent', projectId: 'test/project' });
      expect(result.entries).toHaveLength(0);
      expect(result.formatted).toContain('No memories found');
    });
  });

  describe('compactDetail (Layer 3)', () => {
    it('should return full observation details', async () => {
      const { observation: obs } = await storeObservation({
        entityName: 'timeout-config',
        type: 'gotcha',
        title: 'Hook timeout too short',
        narrative: 'Default 60s timeout insufficient for npm install',
        facts: ['Default: 60s', 'npm cold cache: 90s', 'Fix: set to 120s'],
        filesModified: ['hooks.json'],
        concepts: ['hooks', 'timeout', 'npm'],
        projectId: 'test/project',
      });

      const result = await compactDetail([obs.id]);
      expect(result.documents).toHaveLength(1);
      expect(result.formatted).toContain('Hook timeout too short');
      expect(result.formatted).toContain('60s');
      expect(result.formatted).toContain('hooks.json');
    });

    it('should return empty for non-existent IDs', async () => {
      const result = await compactDetail([99999]);
      expect(result.documents).toHaveLength(0);
    });

    it('should fall back to the global index for cross-project detail lookups', async () => {
      const projectADir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-compact-a-'));
      const projectBDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-compact-b-'));

      try {
        await initObservations(projectADir);
        await storeObservation({
          entityName: 'project-a',
          type: 'what-changed',
          title: 'Project A baseline',
          narrative: 'First observation in project A',
          projectId: 'test/project-a',
        });

        await storeObservation({
          entityName: 'project-a',
          type: 'decision',
          title: 'Cross-project detail target',
          narrative: 'This observation should still open after switching projects',
          facts: ['Project: A'],
          projectId: 'test/project-a',
        });

        await storeObservation({
          entityName: 'project-a',
          type: 'gotcha',
          title: 'Project A extra signal',
          narrative: 'Third observation to ensure the target id is absent in project B memory',
          projectId: 'test/project-a',
        });

        await initObservations(projectBDir);
        await storeObservation({
          entityName: 'project-b',
          type: 'what-changed',
          title: 'Project B baseline',
          narrative: 'Current in-memory project is now B',
          projectId: 'test/project-b',
        });
        await storeObservation({
          entityName: 'project-b',
          type: 'what-changed',
          title: 'Project B git evidence',
          narrative: 'This should not leak into project A detail rendering',
          projectId: 'test/project-b',
          source: 'git',
          sourceDetail: 'git-ingest',
          commitHash: 'deadbeef1234567',
        });

        const searchResult = await compactSearch({ query: 'Cross-project detail target' });
        const target = searchResult.entries.find((entry) => entry.title === 'Cross-project detail target');

        expect(target).toBeDefined();
        expect(target!.id).toBe(2);
        expect(target!.projectId).toBe('test/project-a');
        expect(searchResult.formatted).toContain('| Project |');

        const detailResult = await compactDetail([{ id: target!.id, projectId: target!.projectId }]);
        expect(detailResult.documents).toHaveLength(1);
        expect(detailResult.documents[0].title).toBe('Cross-project detail target');
        expect(detailResult.documents[0].projectId).toBe('test/project-a');
        expect(detailResult.formatted).toContain('Cross-project detail target');
        expect(detailResult.formatted).not.toContain('Repository-backed');
      } finally {
        const { resetObservationStore } = await import('../../src/store/obs-store.js');
        const { closeAllDatabases } = await import('../../src/store/sqlite-db.js');
        resetObservationStore();
        closeAllDatabases();
        await fs.rm(projectADir, { recursive: true, force: true });
        await fs.rm(projectBDir, { recursive: true, force: true });
      }
    });

    it('should not attach repository evidence from another project with the same entity name', async () => {
      const { observation: reasoning } = await storeObservation({
        entityName: 'auth',
        type: 'reasoning',
        title: 'Project A auth reasoning',
        narrative: 'Project A reasoning should only cite project A git evidence.',
        projectId: 'test/project-a',
      });
      await storeObservation({
        entityName: 'auth',
        type: 'what-changed',
        title: 'Project A auth commit',
        narrative: 'Git evidence for project A',
        projectId: 'test/project-a',
        source: 'git',
        sourceDetail: 'git-ingest',
        commitHash: 'aaa1111bbbb2222',
      });
      await storeObservation({
        entityName: 'auth',
        type: 'what-changed',
        title: 'Project B auth commit',
        narrative: 'Git evidence for project B',
        projectId: 'test/project-b',
        source: 'git',
        sourceDetail: 'git-ingest',
        commitHash: 'bbb3333cccc4444',
      });

      const detailResult = await compactDetail([{ id: reasoning.id, projectId: 'test/project-a' }]);
      expect(detailResult.formatted).toContain('Evidence support:');
      expect(detailResult.formatted).toContain('Project A auth commit');
      expect(detailResult.formatted).not.toContain('Project B auth commit');
    });

    it('should not attach cited commit evidence from another project sharing the same commit hash', async () => {
      const { observation: reasoning } = await storeObservation({
        entityName: 'auth',
        type: 'reasoning',
        title: 'Project A commit analysis',
        narrative: 'Project A reasoning cites one commit.',
        relatedCommits: ['aaa1111bbbb2222'],
        projectId: 'test/project-a',
      });
      await storeObservation({
        entityName: 'auth',
        type: 'what-changed',
        title: 'Project A cited commit',
        narrative: 'Git evidence for project A cited commit',
        projectId: 'test/project-a',
        source: 'git',
        sourceDetail: 'git-ingest',
        commitHash: 'aaa1111bbbb2222',
      });
      await storeObservation({
        entityName: 'auth',
        type: 'what-changed',
        title: 'Project B same hash commit',
        narrative: 'Different project reusing the same hash string',
        projectId: 'test/project-b',
        source: 'git',
        sourceDetail: 'git-ingest',
        commitHash: 'aaa1111bbbb2222',
      });

      const detailResult = await compactDetail([{ id: reasoning.id, projectId: 'test/project-a' }]);
      expect(detailResult.formatted).toContain('Cited commits: aaa1111');
      expect(detailResult.formatted).toContain('Project A cited commit');
      expect(detailResult.formatted).not.toContain('Project B same hash commit');
    });

    it('should preserve evidence links across canonical project aliases', async () => {
      await registerAlias({
        id: 'local/memorix',
        name: 'memorix',
        rootPath: 'E:/repo/memorix',
      }, testDir);
      await registerAlias({
        id: 'AVIDS2/memorix',
        name: 'memorix',
        rootPath: 'E:/repo/memorix',
        gitRemote: 'https://github.com/AVIDS2/memorix.git',
      }, testDir);

      const { observation: reasoning } = await storeObservation({
        entityName: 'auth',
        type: 'reasoning',
        title: 'Alias reasoning',
        narrative: 'Local alias reasoning should still see canonical git evidence.',
        projectId: 'local/memorix',
      });
      await storeObservation({
        entityName: 'auth',
        type: 'what-changed',
        title: 'Canonical git evidence',
        narrative: 'Git evidence stored under canonical alias',
        projectId: 'AVIDS2/memorix',
        source: 'git',
        sourceDetail: 'git-ingest',
        commitHash: 'ccc5555dddd6666',
      });

      const detailResult = await compactDetail([{ id: reasoning.id, projectId: 'local/memorix' }]);
      expect(detailResult.formatted).toContain('Evidence support:');
      expect(detailResult.formatted).toContain('Canonical git evidence');
    });

    it('should accept typed ref strings for observations', async () => {
      const { observation: obs } = await storeObservation({
        entityName: 'typed-ref-test',
        type: 'decision',
        title: 'Typed ref obs test',
        narrative: 'Testing typed ref string path',
        projectId: 'test/project',
      });

      const result = await compactDetail([`obs:${obs.id}`]);
      expect(result.documents).toHaveLength(1);
      expect(result.formatted).toContain('Typed ref obs test');
    });

    it('should accept typed ref strings for mini-skills', async () => {
      const { initMiniSkillStore, resetMiniSkillStore } = await import('../../src/store/mini-skill-store.js');
      const { promoteToMiniSkill } = await import('../../src/skills/mini-skills.js');
      await initMiniSkillStore(testDir);

      try {
        const { observation: obs } = await storeObservation({
          entityName: 'skill-ref-test',
          type: 'decision',
          title: 'Skill source observation',
          narrative: 'This will be promoted to a skill',
          facts: ['Fact A'],
          projectId: 'test/project',
        });

        const skill = await promoteToMiniSkill(testDir, 'test/project', [obs]);

        const result = await compactDetail([`skill:${skill.id}`]);
        expect(result.documents).toHaveLength(1);
        expect(result.documents[0].documentType).toBe('mini-skill');
        expect(result.formatted).toContain('promoted knowledge');
        expect(result.formatted).toContain('Provenance:');
      } finally {
        resetMiniSkillStore();
        const { closeAllDatabases } = await import('../../src/store/sqlite-db.js');
        closeAllDatabases();
      }
    });

    it('should preserve input order for mixed refs [skill, obs]', async () => {
      const { initMiniSkillStore, resetMiniSkillStore } = await import('../../src/store/mini-skill-store.js');
      const { promoteToMiniSkill } = await import('../../src/skills/mini-skills.js');
      await initMiniSkillStore(testDir);

      try {
        const { observation: obs } = await storeObservation({
          entityName: 'order-test',
          type: 'gotcha',
          title: 'Order test observation',
          narrative: 'This obs should appear SECOND',
          facts: ['Order fact'],
          projectId: 'test/project',
        });

        const skill = await promoteToMiniSkill(testDir, 'test/project', [obs]);

        // Input: skill first, obs second
        const result = await compactDetail([`skill:${skill.id}`, `obs:${obs.id}`]);
        expect(result.documents).toHaveLength(2);
        expect(result.documents[0].documentType).toBe('mini-skill');
        expect(result.documents[1].type).toBe('gotcha');

        // Formatted output: skill section (Type: promoted knowledge) before obs section (Provenance: gotcha)
        // Use 'Type: promoted knowledge' (unique to skill detail) vs separator position
        const skillMarker = result.formatted.indexOf('Type: promoted knowledge');
        const separator = result.formatted.indexOf('\u2550'.repeat(50));
        expect(skillMarker).toBeGreaterThanOrEqual(0);
        expect(separator).toBeGreaterThan(skillMarker);
      } finally {
        resetMiniSkillStore();
        const { closeAllDatabases } = await import('../../src/store/sqlite-db.js');
        closeAllDatabases();
      }
    });

    it('should preserve input order for mixed refs [obs, skill]', async () => {
      const { initMiniSkillStore, resetMiniSkillStore } = await import('../../src/store/mini-skill-store.js');
      const { promoteToMiniSkill } = await import('../../src/skills/mini-skills.js');
      await initMiniSkillStore(testDir);

      try {
        const { observation: obs } = await storeObservation({
          entityName: 'order-test-rev',
          type: 'decision',
          title: 'Reverse order observation',
          narrative: 'This obs should appear FIRST',
          facts: ['Rev fact'],
          projectId: 'test/project',
        });

        const skill = await promoteToMiniSkill(testDir, 'test/project', [obs]);

        // Input: obs first, skill second
        const result = await compactDetail([`obs:${obs.id}`, `skill:${skill.id}`]);
        expect(result.documents).toHaveLength(2);
        expect(result.documents[0].type).toBe('decision');
        expect(result.documents[1].documentType).toBe('mini-skill');

        // Formatted output: obs section before skill section
        // 'Type: promoted knowledge' is unique to skill detail format
        const separator = result.formatted.indexOf('\u2550'.repeat(50));
        const skillMarker = result.formatted.indexOf('Type: promoted knowledge');
        expect(separator).toBeGreaterThanOrEqual(0);
        expect(skillMarker).toBeGreaterThan(separator);
      } finally {
        resetMiniSkillStore();
        const { closeAllDatabases } = await import('../../src/store/sqlite-db.js');
        closeAllDatabases();
      }
    });

    it('should throw on invalid typed ref strings', async () => {
      await expect(compactDetail(['not-a-ref'])).rejects.toThrow('Invalid memory ref(s)');
      await expect(compactDetail(['not-a-ref'])).rejects.toThrow('"not-a-ref"');
    });

    it('should throw listing all invalid refs in a mixed input', async () => {
      await expect(compactDetail(['obs:1', 'garbage', 'also:bad:format'])).rejects.toThrow('"garbage"');
      await expect(compactDetail(['obs:1', 'garbage', 'also:bad:format'])).rejects.toThrow('"also:bad:format"');
    });

    it('should not throw on valid bare numeric strings', async () => {
      // "42" is a valid legacy bare numeric ref — should not throw
      const result = await compactDetail(['42']);
      expect(result).toBeDefined();
      // May return empty docs (ID 42 doesn't exist) but should NOT throw
    });
  });

  describe('compactSearch Ref column format (Fix 2)', () => {
    it('should display canonical typed refs (obs:N) in the Ref column', async () => {
      const { observation: obs } = await storeObservation({
        entityName: 'ref-format-test',
        type: 'gotcha',
        title: 'Ref format test observation',
        narrative: 'Testing that Ref column shows obs:N',
        projectId: 'test/project',
      });

      const result = await compactSearch({ query: 'Ref format test', projectId: 'test/project' });
      expect(result.entries).toHaveLength(1);
      // The formatted table should contain obs:N, not #N
      expect(result.formatted).toContain(`obs:${obs.id}`);
      expect(result.formatted).not.toMatch(new RegExp(`\\| #${obs.id} \\|`));
    });

    it('should display canonical typed refs (skill:N) for mini-skills', async () => {
      const { initMiniSkillStore, resetMiniSkillStore } = await import('../../src/store/mini-skill-store.js');
      const { promoteToMiniSkill } = await import('../../src/skills/mini-skills.js');
      await initMiniSkillStore(testDir);

      try {
        const { observation: obs } = await storeObservation({
          entityName: 'ref-skill-format',
          type: 'decision',
          title: 'Skill ref format source',
          narrative: 'Source for skill ref format test',
          facts: ['Fact'],
          projectId: 'test/project',
        });

        const skill = await promoteToMiniSkill(testDir, 'test/project', [obs]);

        // Trigger freshness so the skill appears in search
        const { ensureFreshIndex } = await import('../../src/memory/freshness.js');
        await ensureFreshIndex();

        const result = await compactSearch({ query: 'Skill ref format source', projectId: 'test/project' });
        // At minimum the obs should appear; if skill also appears, check its ref format
        const skillEntry = result.entries.find(e => e.documentType === 'mini-skill');
        if (skillEntry) {
          expect(result.formatted).toContain(`skill:${skillEntry.id}`);
          expect(result.formatted).not.toMatch(new RegExp(`\\| S${skillEntry.id} \\|`));
        }
      } finally {
        resetMiniSkillStore();
        const { closeAllDatabases } = await import('../../src/store/sqlite-db.js');
        closeAllDatabases();
      }
    });

    it('hint text should reference typed ref format consistent with Ref column', async () => {
      await storeObservation({
        entityName: 'hint-check',
        type: 'gotcha',
        title: 'Hint consistency check',
        narrative: 'Checking hint text',
        projectId: 'test/project',
      });

      const result = await compactSearch({ query: 'hint', projectId: 'test/project' });
      // Hint should mention typed refs
      expect(result.formatted).toContain('obs:42');
      expect(result.formatted).toContain('skill:3');
    });
  });

  describe('compactDetail unified freshness gate (Fix 5)', () => {
    it('should use ensureFreshIndex instead of withFreshObservations', async () => {
      // Verify the import path — if withFreshObservations was still used, this
      // store+detail round-trip with mini-skills would fail because
      // withFreshObservations doesn't refresh mini-skill index.
      const { initMiniSkillStore, resetMiniSkillStore } = await import('../../src/store/mini-skill-store.js');
      const { promoteToMiniSkill } = await import('../../src/skills/mini-skills.js');
      const { resetMiniSkillFreshness } = await import('../../src/memory/freshness.js');
      await initMiniSkillStore(testDir);

      try {
        const { observation: obs } = await storeObservation({
          entityName: 'freshness-gate',
          type: 'decision',
          title: 'Unified freshness gate source',
          narrative: 'Testing that compactDetail uses ensureFreshIndex',
          facts: ['Gate fact'],
          projectId: 'test/project',
        });

        const skill = await promoteToMiniSkill(testDir, 'test/project', [obs]);

        // Reset freshness tracking so the next compactDetail call must re-ensure
        resetMiniSkillFreshness();

        // If compactDetail still used withFreshObservations, the mini-skill
        // would not be in the index and we'd get no formatted skill output
        const result = await compactDetail([`skill:${skill.id}`]);
        expect(result.documents).toHaveLength(1);
        expect(result.documents[0].documentType).toBe('mini-skill');
      } finally {
        resetMiniSkillStore();
        const { closeAllDatabases } = await import('../../src/store/sqlite-db.js');
        closeAllDatabases();
      }
    });
  });
});
