import { describe, it, expect } from 'vitest';
import { runExtract } from '../../../src/memory/formation/extract.js';
import type { FormationInput } from '../../../src/memory/formation/types.js';

function makeInput(overrides: Partial<FormationInput> = {}): FormationInput {
  return {
    entityName: 'test-module',
    type: 'discovery',
    title: 'Test observation',
    narrative: 'This is a test narrative.',
    facts: [],
    projectId: 'test-project',
    source: 'explicit',
    ...overrides,
  };
}

describe('Formation Stage 1: Extract', () => {
  describe('Fact extraction', () => {
    it('should extract key-value pairs from narrative', () => {
      const result = runExtract(
        makeInput({ narrative: 'The server runs on Port: 3000 with Timeout: 60s' }),
        [],
      );
      expect(result.extractedFacts.length).toBeGreaterThan(0);
      expect(result.extractedFacts.some(f => f.includes('3000'))).toBe(true);
    });

    it('should extract version numbers', () => {
      const result = runExtract(
        makeInput({ narrative: 'Upgraded from v1.2.3 to version 2.0.0' }),
        [],
      );
      expect(result.extractedFacts.some(f => f.includes('1.2.3') || f.includes('2.0.0'))).toBe(true);
    });

    it('should extract error messages', () => {
      const result = runExtract(
        makeInput({ narrative: 'Got Error: ECONNREFUSED when connecting to database' }),
        [],
      );
      expect(result.extractedFacts.some(f => f.includes('ECONNREFUSED'))).toBe(true);
    });

    it('should extract package versions (npm format)', () => {
      const result = runExtract(
        makeInput({ narrative: 'Installed react@18.2.0 and typescript@5.3.2' }),
        [],
      );
      expect(result.extractedFacts.some(f => f.includes('react@18.2.0'))).toBe(true);
    });

    it('should not duplicate caller-provided facts', () => {
      const result = runExtract(
        makeInput({
          narrative: 'Port: 3000 is the default',
          facts: ['Port: 3000'],
        }),
        [],
      );
      // extractedFacts should not include what caller already provided
      expect(result.extractedFacts.every(f => f !== 'Port: 3000')).toBe(true);
      // But allFacts should contain it
      expect(result.facts.some(f => f === 'Port: 3000')).toBe(true);
    });

    it('should cap at 10 extracted facts', () => {
      const narrative = Array.from({ length: 20 }, (_, i) =>
        `Config_${i}: value_${i}`
      ).join('\n');
      const result = runExtract(makeInput({ narrative }), []);
      expect(result.extractedFacts.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Title normalization', () => {
    it('should improve generic "Updated file.ts" titles', () => {
      const result = runExtract(
        makeInput({
          title: 'Updated config.ts',
          narrative: 'Changed the database connection string to use PostgreSQL instead of MySQL for better performance.',
        }),
        [],
      );
      expect(result.titleImproved).toBe(true);
      expect(result.title).not.toBe('Updated config.ts');
      expect(result.title.length).toBeGreaterThan(10);
    });

    it('should keep good titles unchanged', () => {
      const result = runExtract(
        makeInput({ title: 'JWT refresh token causes silent auth failure after 24h' }),
        [],
      );
      expect(result.titleImproved).toBe(false);
      expect(result.title).toBe('JWT refresh token causes silent auth failure after 24h');
    });

    it('should improve "Session activity" titles', () => {
      const result = runExtract(
        makeInput({
          title: 'Session activity',
          narrative: 'Refactored the authentication middleware to support OAuth2 in addition to JWT.',
        }),
        [],
      );
      expect(result.titleImproved).toBe(true);
    });
  });

  describe('Entity resolution', () => {
    it('should resolve to existing entity (case-insensitive)', () => {
      const result = runExtract(
        makeInput({ entityName: 'Auth-Module' }),
        ['auth-module', 'database', 'server'],
      );
      expect(result.entityName).toBe('auth-module');
      expect(result.entityResolved).toBe(true);
    });

    it('should resolve substring matches to the longer name', () => {
      const result = runExtract(
        makeInput({ entityName: 'auth' }),
        ['auth-module', 'database'],
      );
      expect(result.entityName).toBe('auth-module');
      expect(result.entityResolved).toBe(true);
    });

    it('should keep entity if no match found', () => {
      const result = runExtract(
        makeInput({ entityName: 'new-service' }),
        ['auth-module', 'database'],
      );
      expect(result.entityName).toBe('new-service');
      expect(result.entityResolved).toBe(false);
    });

    it('should handle empty entity list', () => {
      const result = runExtract(makeInput({ entityName: 'test' }), []);
      expect(result.entityResolved).toBe(false);
    });
  });

  describe('Type verification', () => {
    it('should correct type when content strongly suggests different type', () => {
      const result = runExtract(
        makeInput({
          type: 'discovery',
          narrative: 'Fixed the bug where the crash was caused by a broken error handler. The issue was resolved by patching the middleware.',
        }),
        [],
      );
      // Content has strong problem-solution signals
      expect(result.typeCorrected).toBe(true);
      expect(result.type).toBe('problem-solution');
    });

    it('should keep type when content matches declared type', () => {
      const result = runExtract(
        makeInput({
          type: 'decision',
          narrative: 'Decided to use PostgreSQL. We evaluated MongoDB but chose SQL for ACID compliance.',
        }),
        [],
      );
      expect(result.typeCorrected).toBe(false);
      expect(result.type).toBe('decision');
    });

    it('should not correct when signals are weak', () => {
      const result = runExtract(
        makeInput({
          type: 'discovery',
          narrative: 'Found that the API returns JSON by default.',
        }),
        [],
      );
      expect(result.typeCorrected).toBe(false);
    });
  });
});
