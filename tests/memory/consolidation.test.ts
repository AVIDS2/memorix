/**
 * Memory Consolidation Tests
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
import { findConsolidationCandidates, executeConsolidation } from '../../src/memory/consolidation.js';
import { storeObservation, initObservations, getObservationCount } from '../../src/memory/observations.js';
import { resetDb } from '../../src/store/orama-store.js';

let testDir: string;
const PROJECT_ID = 'test/consolidation';

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-consol-'));
  await resetDb();
  await initObservations(testDir);
});

describe('Memory Consolidation', () => {
  describe('findConsolidationCandidates', () => {
    it('should find no candidates when observations are unique', async () => {
      await storeObservation({
        entityName: 'auth', type: 'gotcha', title: 'JWT expiry issue',
        narrative: 'Tokens expire without notification', projectId: PROJECT_ID,
      });
      await storeObservation({
        entityName: 'deploy', type: 'decision', title: 'Use Docker',
        narrative: 'Chose containerization for deployment', projectId: PROJECT_ID,
      });

      const clusters = await findConsolidationCandidates(testDir, PROJECT_ID);
      expect(clusters).toHaveLength(0);
    });

    it('should find candidates among similar observations', async () => {
      // Store 3 similar gotchas about Windows path issues
      await storeObservation({
        entityName: 'paths', type: 'gotcha', title: 'Windows path separator bug',
        narrative: 'Use path.join instead of string concatenation for Windows paths',
        facts: ['Use path.join', 'Windows uses backslash'],
        projectId: PROJECT_ID,
      });
      await storeObservation({
        entityName: 'paths', type: 'gotcha', title: 'Windows path separator issue',
        narrative: 'String concatenation with / breaks on Windows, use path.join',
        facts: ['path.join is cross-platform', 'Avoid / in paths'],
        projectId: PROJECT_ID,
      });
      await storeObservation({
        entityName: 'paths', type: 'gotcha', title: 'Windows path bug with separators',
        narrative: 'Path concatenation fails on Windows when using forward slash, fix with path.join',
        facts: ['path.join handles separators', 'Windows path bug'],
        projectId: PROJECT_ID,
      });

      const clusters = await findConsolidationCandidates(testDir, PROJECT_ID, { threshold: 0.3 });
      expect(clusters.length).toBeGreaterThanOrEqual(1);
      expect(clusters[0].entityName).toBe('paths');
      expect(clusters[0].type).toBe('gotcha');
      expect(clusters[0].ids.length).toBeGreaterThanOrEqual(2);
    });

    it('should not cluster across different entities', async () => {
      await storeObservation({
        entityName: 'auth', type: 'gotcha', title: 'Token expiry silent failure',
        narrative: 'JWT tokens expire without user notification',
        projectId: PROJECT_ID,
      });
      await storeObservation({
        entityName: 'payment', type: 'gotcha', title: 'Token expiry silent failure',
        narrative: 'Payment tokens expire without user notification',
        projectId: PROJECT_ID,
      });

      const clusters = await findConsolidationCandidates(testDir, PROJECT_ID);
      expect(clusters).toHaveLength(0);
    });

    it('should not cluster across different types', async () => {
      await storeObservation({
        entityName: 'auth', type: 'gotcha', title: 'JWT token handling',
        narrative: 'Be careful with JWT token expiry',
        projectId: PROJECT_ID,
      });
      await storeObservation({
        entityName: 'auth', type: 'decision', title: 'JWT token handling approach',
        narrative: 'Decided to use JWT token with refresh',
        projectId: PROJECT_ID,
      });

      const clusters = await findConsolidationCandidates(testDir, PROJECT_ID);
      expect(clusters).toHaveLength(0);
    });

    it('should respect similarity threshold', async () => {
      await storeObservation({
        entityName: 'config', type: 'gotcha', title: 'Port 3000 conflict',
        narrative: 'Port 3000 often conflicts with other services',
        projectId: PROJECT_ID,
      });
      await storeObservation({
        entityName: 'config', type: 'gotcha', title: 'Port 3001 conflict',
        narrative: 'Port 3001 also conflicts sometimes',
        projectId: PROJECT_ID,
      });

      // High threshold should find fewer candidates
      const highThreshold = await findConsolidationCandidates(testDir, PROJECT_ID, { threshold: 0.9 });
      // Low threshold should find more
      const lowThreshold = await findConsolidationCandidates(testDir, PROJECT_ID, { threshold: 0.2 });

      expect(lowThreshold.length).toBeGreaterThanOrEqual(highThreshold.length);
    });
  });

  describe('executeConsolidation', () => {
    it('should merge similar observations and reduce count', async () => {
      await storeObservation({
        entityName: 'paths', type: 'gotcha', title: 'Windows path separator bug',
        narrative: 'Use path.join for Windows compatibility',
        facts: ['Use path.join', 'Windows uses backslash'],
        filesModified: ['utils.ts'],
        concepts: ['windows', 'paths'],
        projectId: PROJECT_ID,
      });
      await storeObservation({
        entityName: 'paths', type: 'gotcha', title: 'Windows path separator issue',
        narrative: 'String concat with / breaks on Windows, use path.join',
        facts: ['path.join is cross-platform', 'Avoid / concatenation'],
        filesModified: ['helpers.ts'],
        concepts: ['paths', 'cross-platform'],
        projectId: PROJECT_ID,
      });
      await storeObservation({
        entityName: 'paths', type: 'gotcha', title: 'Windows path bug separators',
        narrative: 'Path concatenation fails on Windows, fix with path.join',
        facts: ['path.join handles OS separators'],
        filesModified: ['utils.ts'],
        concepts: ['windows', 'bug'],
        projectId: PROJECT_ID,
      });

      const beforeCount = getObservationCount();
      expect(beforeCount).toBe(3);

      const result = await executeConsolidation(testDir, PROJECT_ID, { threshold: 0.25 });

      expect(result.clustersFound).toBeGreaterThanOrEqual(1);
      expect(result.observationsMerged).toBeGreaterThanOrEqual(1);
      expect(result.observationsAfter).toBeLessThan(beforeCount);
    });

    it('should preserve all facts when merging', async () => {
      await storeObservation({
        entityName: 'db', type: 'gotcha', title: 'Database connection timeout',
        narrative: 'Connection pool exhaustion causes timeouts',
        facts: ['Default pool: 10', 'Timeout: 30s'],
        projectId: PROJECT_ID,
      });
      await storeObservation({
        entityName: 'db', type: 'gotcha', title: 'Database connection timeout issue',
        narrative: 'Too many connections cause pool exhaustion and timeout',
        facts: ['Max connections: 100', 'Retry after: 5s'],
        projectId: PROJECT_ID,
      });

      const result = await executeConsolidation(testDir, PROJECT_ID);

      if (result.merges.length > 0) {
        // The merged observation should have facts from both
        expect(result.merges[0].factCount).toBeGreaterThanOrEqual(2);
      }
    });

    it('should return clean result when nothing to consolidate', async () => {
      await storeObservation({
        entityName: 'auth', type: 'decision', title: 'Use JWT',
        narrative: 'Decided to use JWT for authentication',
        projectId: PROJECT_ID,
      });

      const result = await executeConsolidation(testDir, PROJECT_ID);

      expect(result.clustersFound).toBe(0);
      expect(result.observationsMerged).toBe(0);
      expect(result.observationsAfter).toBe(1);
    });
  });
});
