/**
 * Retention & Decay Tests
 *
 * Tests the memory relevance scoring and retention lifecycle.
 * Patterns from mcp-memory-service + MemCP.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  calculateRelevance,
  rankByRelevance,
  isImmune,
  getRetentionZone,
  getArchiveCandidates,
  getRetentionSummary,
  getImportanceLevel,
  archiveExpired,
} from '../../src/memory/retention.js';
import type { MemorixDocument } from '../../src/types.js';

function makeDoc(overrides: Partial<MemorixDocument> = {}): MemorixDocument {
  return {
    id: 'obs-1',
    observationId: 1,
    entityName: 'test',
    type: 'decision',
    title: 'Test',
    narrative: 'Test narrative',
    facts: '',
    filesModified: '',
    concepts: '',
    tokens: 50,
    createdAt: new Date().toISOString(),
    projectId: 'test',
    accessCount: 0,
    lastAccessedAt: '',
    ...overrides,
  };
}

describe('Retention & Decay', () => {
  describe('getImportanceLevel', () => {
    it('should map gotcha/decision/trade-off to high', () => {
      expect(getImportanceLevel(makeDoc({ type: 'gotcha' }))).toBe('high');
      expect(getImportanceLevel(makeDoc({ type: 'decision' }))).toBe('high');
      expect(getImportanceLevel(makeDoc({ type: 'trade-off' }))).toBe('high');
    });

    it('should map session-request to low', () => {
      expect(getImportanceLevel(makeDoc({ type: 'session-request' }))).toBe('low');
    });

    it('should default to medium for unknown types', () => {
      expect(getImportanceLevel(makeDoc({ type: 'unknown' }))).toBe('medium');
    });
  });

  describe('calculateRelevance', () => {
    it('should give high score to fresh high-importance observations', () => {
      const doc = makeDoc({ type: 'decision', createdAt: new Date().toISOString() });
      const score = calculateRelevance(doc);
      expect(score.totalScore).toBeGreaterThan(0.7);
      expect(score.baseImportance).toBe(0.8); // high = 0.8
      expect(score.decayFactor).toBeCloseTo(1.0, 1);
    });

    it('should decay old observations', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 120); // 120 days ago
      const doc = makeDoc({ type: 'how-it-works', createdAt: oldDate.toISOString() });
      const score = calculateRelevance(doc);
      // Medium importance, 120 days old with 90-day retention → significant decay
      expect(score.decayFactor).toBeLessThan(0.5);
      expect(score.ageDays).toBeGreaterThan(119);
    });

    it('should boost frequently accessed observations', () => {
      const doc = makeDoc({ accessCount: 5 });
      const score = calculateRelevance(doc);
      expect(score.accessBoost).toBe(1.5); // 1 + 0.1 * 5
    });

    it('should cap access boost at 2.0', () => {
      const doc = makeDoc({ accessCount: 20 });
      const score = calculateRelevance(doc);
      expect(score.accessBoost).toBe(2.0);
    });

    it('should give immune observations minimum 0.5 score', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 365);
      const doc = makeDoc({
        type: 'decision', // high importance → immune
        createdAt: oldDate.toISOString(),
      });
      const score = calculateRelevance(doc);
      expect(score.totalScore).toBeGreaterThanOrEqual(0.5);
      expect(score.isImmune).toBe(true);
    });
  });

  describe('isImmune', () => {
    it('should protect high importance observations', () => {
      expect(isImmune(makeDoc({ type: 'gotcha' }))).toBe(true);
      expect(isImmune(makeDoc({ type: 'decision' }))).toBe(true);
    });

    it('should protect frequently accessed observations', () => {
      expect(isImmune(makeDoc({ type: 'session-request', accessCount: 3 }))).toBe(true);
      expect(isImmune(makeDoc({ type: 'session-request', accessCount: 2 }))).toBe(false);
    });

    it('should protect pinned/keep tagged observations', () => {
      expect(isImmune(makeDoc({ type: 'session-request', concepts: 'pinned, other' }))).toBe(true);
      expect(isImmune(makeDoc({ type: 'session-request', concepts: 'keep' }))).toBe(true);
    });

    it('should not protect low importance unaccessed observations', () => {
      expect(isImmune(makeDoc({ type: 'session-request', accessCount: 0 }))).toBe(false);
    });
  });

  describe('rankByRelevance', () => {
    it('should rank fresh high-importance first', () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

      const docs = [
        makeDoc({ observationId: 1, type: 'session-request', createdAt: oldDate.toISOString() }),
        makeDoc({ observationId: 2, type: 'decision', createdAt: now.toISOString() }),
        makeDoc({ observationId: 3, type: 'how-it-works', createdAt: now.toISOString() }),
      ];

      const ranked = rankByRelevance(docs, now);
      expect(ranked[0].observationId).toBe(2); // fresh decision
      expect(ranked[ranked.length - 1].observationId).toBe(1); // old session-request
    });
  });

  describe('getRetentionZone', () => {
    it('should classify fresh observations as active', () => {
      const doc = makeDoc({ type: 'how-it-works', createdAt: new Date().toISOString() });
      expect(getRetentionZone(doc)).toBe('active');
    });

    it('should classify old medium observations as stale', () => {
      const date = new Date();
      date.setDate(date.getDate() - 50); // 50 days > 90*0.5=45
      const doc = makeDoc({ type: 'how-it-works', createdAt: date.toISOString() });
      expect(getRetentionZone(doc)).toBe('stale');
    });

    it('should classify very old low-importance observations as archive-candidate', () => {
      const date = new Date();
      date.setDate(date.getDate() - 60); // 60 days > 30-day retention for low
      const doc = makeDoc({ type: 'session-request', createdAt: date.toISOString() });
      expect(getRetentionZone(doc)).toBe('archive-candidate');
    });

    it('should keep recently accessed observations active', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 200);
      const recentAccess = new Date();
      recentAccess.setDate(recentAccess.getDate() - 3); // 3 days ago
      const doc = makeDoc({
        type: 'session-request',
        createdAt: oldDate.toISOString(),
        lastAccessedAt: recentAccess.toISOString(),
      });
      expect(getRetentionZone(doc)).toBe('active');
    });

    it('should keep immune observations active regardless of age', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 400);
      const doc = makeDoc({ type: 'decision', createdAt: oldDate.toISOString() });
      expect(getRetentionZone(doc)).toBe('active');
    });
  });

  describe('getArchiveCandidates', () => {
    it('should return only archive-candidate observations', () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000); // 60 days

      const docs = [
        makeDoc({ observationId: 1, type: 'decision', createdAt: now.toISOString() }),
        makeDoc({ observationId: 2, type: 'session-request', createdAt: oldDate.toISOString() }),
        makeDoc({ observationId: 3, type: 'how-it-works', createdAt: now.toISOString() }),
      ];

      const candidates = getArchiveCandidates(docs, now);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].observationId).toBe(2);
    });
  });

  describe('getRetentionSummary', () => {
    it('should return correct counts', () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

      const docs = [
        makeDoc({ observationId: 1, type: 'decision', createdAt: now.toISOString() }), // active + immune
        makeDoc({ observationId: 2, type: 'session-request', createdAt: oldDate.toISOString() }), // archive-candidate
        makeDoc({ observationId: 3, type: 'how-it-works', createdAt: now.toISOString() }), // active
      ];

      const summary = getRetentionSummary(docs, now);
      expect(summary.active).toBe(2);
      expect(summary.archiveCandidates).toBe(1);
      expect(summary.immune).toBeGreaterThanOrEqual(1);
    });
  });

  describe('archiveExpired', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-archive-test-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should archive expired observations and keep active ones', async () => {
      const now = new Date();
      const expiredDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago
      const recentDate = now.toISOString();

      const observations = [
        { id: 1, entityName: 'a', type: 'session-request', title: 'Old', narrative: '', facts: [], filesModified: [], concepts: [], tokens: 10, createdAt: expiredDate, projectId: 'test' },
        { id: 2, entityName: 'b', type: 'decision', title: 'Recent', narrative: '', facts: [], filesModified: [], concepts: [], tokens: 20, createdAt: recentDate, projectId: 'test' },
      ];

      await fs.writeFile(path.join(tmpDir, 'observations.json'), JSON.stringify(observations));

      const result = await archiveExpired(tmpDir, now);
      expect(result.archived).toBe(1);
      expect(result.remaining).toBe(1);

      // Active observations should remain
      const remaining = JSON.parse(await fs.readFile(path.join(tmpDir, 'observations.json'), 'utf-8'));
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(2);

      // Archived observations should be in archive file
      const archived = JSON.parse(await fs.readFile(path.join(tmpDir, 'observations.archived.json'), 'utf-8'));
      expect(archived).toHaveLength(1);
      expect(archived[0].id).toBe(1);
    });

    it('should return 0 archived when nothing is expired', async () => {
      const now = new Date();
      const observations = [
        { id: 1, entityName: 'a', type: 'decision', title: 'Recent', narrative: '', facts: [], filesModified: [], concepts: [], tokens: 10, createdAt: now.toISOString(), projectId: 'test' },
      ];

      await fs.writeFile(path.join(tmpDir, 'observations.json'), JSON.stringify(observations));

      const result = await archiveExpired(tmpDir, now);
      expect(result.archived).toBe(0);
      expect(result.remaining).toBe(1);
    });

    it('should append to existing archive file', async () => {
      const now = new Date();
      const expiredDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();

      // Pre-existing archive
      await fs.writeFile(path.join(tmpDir, 'observations.archived.json'), JSON.stringify([{ id: 0, title: 'Previously archived' }]));

      const observations = [
        { id: 1, entityName: 'a', type: 'session-request', title: 'Expired', narrative: '', facts: [], filesModified: [], concepts: [], tokens: 10, createdAt: expiredDate, projectId: 'test' },
      ];
      await fs.writeFile(path.join(tmpDir, 'observations.json'), JSON.stringify(observations));

      await archiveExpired(tmpDir, now);

      const archived = JSON.parse(await fs.readFile(path.join(tmpDir, 'observations.archived.json'), 'utf-8'));
      expect(archived).toHaveLength(2);
      expect(archived[0].id).toBe(0); // previously archived
      expect(archived[1].id).toBe(1); // newly archived
    });
  });
});
