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
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-compact-'));
  await resetDb();
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
      expect(result.formatted).toContain('| ID |');
      expect(result.formatted).toContain('JWT');
      expect(result.formatted).toContain('Progressive Disclosure');
    });

    it('should return empty message when no results', async () => {
      const result = await compactSearch({ query: 'nonexistent', projectId: 'test/project' });
      expect(result.entries).toHaveLength(0);
      expect(result.formatted).toContain('No observations found');
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
        await fs.rm(projectADir, { recursive: true, force: true });
        await fs.rm(projectBDir, { recursive: true, force: true });
      }
    });
  });
});
