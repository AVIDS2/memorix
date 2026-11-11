/**
 * Auto-Enrichment Integration Tests
 *
 * Tests that storeObservation auto-extracts entities and enriches
 * concepts/filesModified from narrative content.
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
import { storeObservation, initObservations } from '../../src/memory/observations.js';
import { resetDb } from '../../src/store/orama-store.js';

let testDir: string;
const PROJECT_ID = 'test/auto-enrichment';

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-enrich-'));
  await resetDb();
  await initObservations(testDir);
});

describe('Auto-Enrichment on Store', () => {
  it('should auto-extract file paths from narrative into filesModified', async () => {
    const { observation: obs } = await storeObservation({
      entityName: 'auth-module',
      type: 'what-changed',
      title: 'Updated authentication flow',
      narrative: 'Refactored src/auth/jwt.ts to use refresh tokens, also updated src/config/env.ts',
      projectId: PROJECT_ID,
    });

    expect(obs.filesModified).toContain('src/auth/jwt.ts');
    expect(obs.filesModified).toContain('src/config/env.ts');
  });

  it('should not duplicate user-provided files', async () => {
    const { observation: obs } = await storeObservation({
      entityName: 'auth-module',
      type: 'what-changed',
      title: 'Updated auth',
      narrative: 'Changed src/auth/jwt.ts for token refresh',
      filesModified: ['src/auth/jwt.ts'],
      projectId: PROJECT_ID,
    });

    const jwtCount = obs.filesModified.filter((f) => f === 'src/auth/jwt.ts').length;
    expect(jwtCount).toBe(1);
  });

  it('should auto-enrich concepts from CamelCase identifiers', async () => {
    const { observation: obs } = await storeObservation({
      entityName: 'graph',
      type: 'how-it-works',
      title: 'Knowledge graph design',
      narrative: 'The KnowledgeGraphManager uses WorkspaceSyncEngine for cross-agent sync',
      projectId: PROJECT_ID,
    });

    expect(obs.concepts).toContain('KnowledgeGraphManager');
    expect(obs.concepts).toContain('WorkspaceSyncEngine');
  });

  it('should detect causal language', async () => {
    const { observation: causalObs } = await storeObservation({
      entityName: 'decision',
      type: 'decision',
      title: 'Chose Express',
      narrative: 'Chose Express because it has a larger ecosystem than Fastify',
      projectId: PROJECT_ID,
    });
    expect(causalObs.hasCausalLanguage).toBe(true);

    const { observation: nonCausalObs } = await storeObservation({
      entityName: 'change',
      type: 'what-changed',
      title: 'Updated config',
      narrative: 'Changed the port from 3000 to 3001',
      projectId: PROJECT_ID,
    });
    expect(nonCausalObs.hasCausalLanguage).toBe(false);
  });

  it('should preserve user-provided concepts alongside auto-enriched ones', async () => {
    const { observation: obs } = await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'JWT auth',
      narrative: 'Using JsonWebToken library in src/auth/jwt.ts',
      concepts: ['auth', 'security'],
      projectId: PROJECT_ID,
    });

    // User concepts preserved
    expect(obs.concepts).toContain('auth');
    expect(obs.concepts).toContain('security');
    // Auto-enriched from file name
    expect(obs.concepts).toContain('jwt');
    // Auto-enriched from CamelCase
    expect(obs.concepts).toContain('JsonWebToken');
  });
});
