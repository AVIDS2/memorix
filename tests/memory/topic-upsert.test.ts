/**
 * Topic Key Upsert Tests
 *
 * Tests that memorix_store with topicKey updates existing observations
 * instead of creating duplicates. Inspired by Engram's topic_key upsert.
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
import { storeObservation, initObservations, getObservation, getObservationCount, suggestTopicKey } from '../../src/memory/observations.js';
import { resetDb } from '../../src/store/orama-store.js';

let testDir: string;
const PROJECT_ID = 'test/topic-upsert';

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-upsert-'));
  await resetDb();
  await initObservations(testDir);
});

describe('Topic Key Upsert', () => {
  it('should create new observation when topicKey is new', async () => {
    const { observation, upserted } = await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'Use JWT for auth',
      narrative: 'Initial decision to use JWT',
      topicKey: 'decision/jwt-auth',
      projectId: PROJECT_ID,
    });

    expect(upserted).toBe(false);
    expect(observation.topicKey).toBe('decision/jwt-auth');
    expect(observation.revisionCount).toBe(1);
    expect(getObservationCount()).toBe(1);
  });

  it('should upsert existing observation with same topicKey', async () => {
    // First store
    const { observation: first } = await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'Use JWT for auth',
      narrative: 'Initial decision to use JWT',
      topicKey: 'decision/jwt-auth',
      projectId: PROJECT_ID,
    });

    // Second store with same topicKey — should upsert
    const { observation: second, upserted } = await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'Use JWT for auth (updated)',
      narrative: 'Updated decision: use JWT with refresh tokens',
      topicKey: 'decision/jwt-auth',
      projectId: PROJECT_ID,
    });

    expect(upserted).toBe(true);
    expect(second.id).toBe(first.id); // same ID preserved
    expect(second.title).toBe('Use JWT for auth (updated)');
    expect(second.narrative).toContain('refresh tokens');
    expect(second.revisionCount).toBe(2);
    expect(second.updatedAt).toBeTruthy();
    expect(getObservationCount()).toBe(1); // no duplicate created
  });

  it('should increment revisionCount on each upsert', async () => {
    const topicKey = 'architecture/data-model';

    await storeObservation({
      entityName: 'data',
      type: 'decision',
      title: 'Data model v1',
      narrative: 'Version 1',
      topicKey,
      projectId: PROJECT_ID,
    });

    await storeObservation({
      entityName: 'data',
      type: 'decision',
      title: 'Data model v2',
      narrative: 'Version 2',
      topicKey,
      projectId: PROJECT_ID,
    });

    const { observation } = await storeObservation({
      entityName: 'data',
      type: 'decision',
      title: 'Data model v3',
      narrative: 'Version 3',
      topicKey,
      projectId: PROJECT_ID,
    });

    expect(observation.revisionCount).toBe(3);
    expect(observation.title).toBe('Data model v3');
    expect(getObservationCount()).toBe(1);
  });

  it('should not upsert across different projects', async () => {
    await storeObservation({
      entityName: 'config',
      type: 'decision',
      title: 'Port 3000',
      narrative: 'Use port 3000',
      topicKey: 'config/port',
      projectId: 'project-a',
    });

    const { upserted } = await storeObservation({
      entityName: 'config',
      type: 'decision',
      title: 'Port 4000',
      narrative: 'Use port 4000',
      topicKey: 'config/port',
      projectId: 'project-b',
    });

    expect(upserted).toBe(false);
    expect(getObservationCount()).toBe(2);
  });

  it('should create new observation when no topicKey provided', async () => {
    await storeObservation({
      entityName: 'misc',
      type: 'discovery',
      title: 'Finding A',
      narrative: 'First finding',
      projectId: PROJECT_ID,
    });

    await storeObservation({
      entityName: 'misc',
      type: 'discovery',
      title: 'Finding A',
      narrative: 'Duplicate title but no topicKey',
      projectId: PROJECT_ID,
    });

    expect(getObservationCount()).toBe(2); // both created
  });

  it('should preserve createdAt on upsert', async () => {
    const { observation: first } = await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'Auth v1',
      narrative: 'First version',
      topicKey: 'decision/auth',
      projectId: PROJECT_ID,
    });

    // Small delay to ensure different timestamps
    await new Promise(r => setTimeout(r, 10));

    const { observation: second } = await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'Auth v2',
      narrative: 'Second version',
      topicKey: 'decision/auth',
      projectId: PROJECT_ID,
    });

    expect(second.createdAt).toBe(first.createdAt); // original timestamp preserved
    expect(second.updatedAt).not.toBe(first.createdAt); // updatedAt is different
  });
});

describe('suggestTopicKey', () => {
  it('should generate architecture/* key for architecture type', () => {
    const key = suggestTopicKey('architecture', 'Auth module design');
    expect(key).toBe('architecture/auth-module-design');
  });

  it('should generate bug/* key for bugfix type', () => {
    const key = suggestTopicKey('bugfix', 'Fixed timeout in API gateway');
    expect(key).toBe('bug/fixed-timeout-in-api-gateway');
  });

  it('should generate decision/* key for decision type', () => {
    const key = suggestTopicKey('decision', 'Choose PostgreSQL over MySQL');
    expect(key).toBe('decision/choose-postgresql-over-mysql');
  });

  it('should generate discovery/* key for discovery type', () => {
    const key = suggestTopicKey('discovery', 'Found memory leak');
    expect(key).toBe('discovery/found-memory-leak');
  });

  it('should generate general/* key for unknown type', () => {
    const key = suggestTopicKey('random', 'Some observation');
    expect(key).toBe('general/some-observation');
  });

  it('should handle CJK characters in title', () => {
    const key = suggestTopicKey('decision', '选择JWT认证方案');
    expect(key).toMatch(/^decision\//);
    expect(key).toContain('选择');
  });

  it('should return empty string for empty title', () => {
    const key = suggestTopicKey('decision', '');
    expect(key).toBe('');
  });

  it('should truncate long titles to 60 chars', () => {
    const longTitle = 'a'.repeat(100);
    const key = suggestTopicKey('decision', longTitle);
    // family/ + max 60 chars
    expect(key.length).toBeLessThanOrEqual('decision/'.length + 60);
  });
});
