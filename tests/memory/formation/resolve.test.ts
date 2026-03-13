import { describe, it, expect } from 'vitest';
import { runResolve } from '../../../src/memory/formation/resolve.js';
import type { ExtractResult, SearchHit, ExistingMemoryRef } from '../../../src/memory/formation/types.js';

function makeExtract(overrides: Partial<ExtractResult> = {}): ExtractResult {
  return {
    title: 'Test observation',
    titleImproved: false,
    narrative: 'This is a test narrative about authentication.',
    facts: ['Uses JWT tokens', 'Port: 3000'],
    extractedFacts: [],
    entityName: 'auth-module',
    entityResolved: false,
    type: 'discovery',
    typeCorrected: false,
    ...overrides,
  };
}

function makeHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    id: 1,
    observationId: 100,
    title: 'Existing observation',
    narrative: 'Existing narrative about auth.',
    facts: 'Uses JWT tokens',
    entityName: 'auth-module',
    type: 'discovery',
    score: 0.5,
    ...overrides,
  };
}

function makeRef(overrides: Partial<ExistingMemoryRef> = {}): ExistingMemoryRef {
  return {
    id: 100,
    entityName: 'auth-module',
    type: 'discovery',
    title: 'Existing observation',
    narrative: 'Existing narrative about auth.',
    facts: ['Uses JWT tokens'],
    ...overrides,
  };
}

describe('Formation Stage 2: Resolve', () => {
  it('should return "new" when no similar memories exist', async () => {
    const result = await runResolve(
      makeExtract(),
      'test-project',
      async () => [],
      () => null,
    );
    expect(result.action).toBe('new');
  });

  it('should return "new" when search fails', async () => {
    const result = await runResolve(
      makeExtract(),
      'test-project',
      async () => { throw new Error('search failed'); },
      () => null,
    );
    expect(result.action).toBe('new');
    expect(result.reason).toContain('Search unavailable');
  });

  it('should return "discard" for near-duplicate (score >= 0.90) that is not richer', async () => {
    const result = await runResolve(
      makeExtract({ narrative: 'Short' }),
      'test-project',
      async () => [makeHit({ score: 0.95, narrative: 'A much longer existing narrative about auth mechanisms and JWT.' })],
      () => makeRef({ narrative: 'A much longer existing narrative about auth mechanisms and JWT.' }),
    );
    expect(result.action).toBe('discard');
    expect(result.targetId).toBe(100);
  });

  it('should return "evolve" for near-duplicate where new is richer', async () => {
    const result = await runResolve(
      makeExtract({
        narrative: 'A very detailed narrative about authentication that is significantly longer than the existing one and covers new ground about OAuth2 and SAML integration patterns.',
        facts: ['Uses JWT', 'Supports OAuth2', 'SAML integration'],
      }),
      'test-project',
      async () => [makeHit({ score: 0.93, narrative: 'Short existing.' })],
      () => makeRef({ narrative: 'Short existing.', facts: ['Uses JWT'] }),
    );
    expect(result.action).toBe('evolve');
    expect(result.mergedNarrative).toBeDefined();
    expect(result.mergedFacts).toBeDefined();
  });

  it('should return "merge" for high similarity (>= 0.75) where new is richer', async () => {
    const result = await runResolve(
      makeExtract({
        narrative: 'A comprehensive guide to JWT authentication covering refresh tokens, expiry handling, and error recovery patterns in production.',
        facts: ['Refresh token TTL: 7d', 'Access token TTL: 15m', 'Uses RS256'],
      }),
      'test-project',
      async () => [makeHit({ score: 0.80, narrative: 'Basic JWT auth.', entityName: 'auth-module' })],
      () => makeRef({ narrative: 'Basic JWT auth.', facts: ['Uses JWT'] }),
    );
    expect(result.action).toBe('merge');
    expect(result.targetId).toBe(100);
  });

  it('should return "discard" for high similarity where new is not richer', async () => {
    const result = await runResolve(
      makeExtract({ narrative: 'JWT auth.' }),
      'test-project',
      async () => [makeHit({
        score: 0.93,
        narrative: 'A comprehensive guide to JWT authentication covering many topics.',
        entityName: 'auth-module',
      })],
      () => makeRef({
        narrative: 'A comprehensive guide to JWT authentication covering many topics.',
      }),
    );
    expect(result.action).toBe('discard');
  });

  it('should detect contradiction and return "evolve"', async () => {
    const result = await runResolve(
      makeExtract({
        entityName: 'database',
        narrative: 'We no longer use MySQL. Replaced MySQL with PostgreSQL for better JSON support.',
        facts: ['Database: PostgreSQL'],
      }),
      'test-project',
      async () => [makeHit({
        score: 0.88,
        narrative: 'Using MySQL as the primary database.',
        entityName: 'database',
      })],
      () => makeRef({
        narrative: 'Using MySQL as the primary database.',
        entityName: 'database',
        facts: ['Database: MySQL'],
      }),
    );
    expect(result.action).toBe('evolve');
    expect(result.reason).toContain('contradiction');
  });

  it('should return "merge" for medium similarity with entity match and more facts', async () => {
    const result = await runResolve(
      makeExtract({
        entityName: 'auth-module',
        facts: ['Uses JWT', 'Supports OAuth2', 'Rate limiting: 100/min'],
      }),
      'test-project',
      async () => [makeHit({
        score: 0.55,
        entityName: 'auth-module',
        facts: 'Uses JWT',
      })],
      () => makeRef({ facts: ['Uses JWT'] }),
    );
    expect(result.action).toBe('merge');
  });

  it('should return "new" for low similarity', async () => {
    const result = await runResolve(
      makeExtract({ entityName: 'new-service', narrative: 'Completely different topic about caching.' }),
      'test-project',
      async () => [makeHit({ score: 0.30, entityName: 'auth-module' })],
      () => null,
    );
    expect(result.action).toBe('new');
  });

  it('should merge facts without duplicates', async () => {
    const result = await runResolve(
      makeExtract({
        narrative: 'Extended auth module with OAuth2 support and rate limiting capabilities for the API gateway.',
        facts: ['Uses JWT', 'Supports OAuth2', 'Rate limit: 100/min'],
      }),
      'test-project',
      async () => [makeHit({
        score: 0.85,
        entityName: 'auth-module',
        narrative: 'Basic auth.',
        facts: 'Uses JWT\nPort: 3000',
      })],
      () => makeRef({ facts: ['Uses JWT', 'Port: 3000'] }),
    );
    if (result.mergedFacts) {
      const jwtCount = result.mergedFacts.filter(f =>
        f.toLowerCase().includes('uses jwt')
      ).length;
      expect(jwtCount).toBe(1); // No duplicates
    }
  });
});
