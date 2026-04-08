/**
 * Export/Import Tests
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
import { exportAsJson, exportAsMarkdown, importFromJson } from '../../src/memory/export-import.js';
import { storeObservation, initObservations, getObservationCount } from '../../src/memory/observations.js';
import { resetDb } from '../../src/store/orama-store.js';
import { startSession, endSession } from '../../src/memory/session.js';
import { initObservationStore, resetObservationStore } from '../../src/store/obs-store.js';
import { initSessionStore, resetSessionStore } from '../../src/store/session-store.js';

let testDir: string;
const PROJECT_ID = 'test/export-import';

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-export-'));
  resetObservationStore();
  resetSessionStore();
  await resetDb();
  await initObservationStore(testDir);
  await initSessionStore(testDir);
  await initObservations(testDir);
});

describe('Export', () => {
  it('should export observations as JSON', async () => {
    await storeObservation({
      entityName: 'auth', type: 'decision', title: 'Use JWT',
      narrative: 'Decided JWT for auth', projectId: PROJECT_ID,
    });
    await storeObservation({
      entityName: 'deploy', type: 'gotcha', title: 'Port conflict',
      narrative: 'Port 3000 conflicts', projectId: PROJECT_ID,
    });

    const data = await exportAsJson(testDir, PROJECT_ID);

    expect(data.version).toBe('0.9.0');
    expect(data.projectId).toBe(PROJECT_ID);
    expect(data.observations).toHaveLength(2);
    expect(data.stats.observationCount).toBe(2);
    expect(data.stats.typeBreakdown['decision']).toBe(1);
    expect(data.stats.typeBreakdown['gotcha']).toBe(1);
  });

  it('should export sessions', async () => {
    await startSession(testDir, PROJECT_ID, { sessionId: 'export-s1' });
    await endSession(testDir, 'export-s1', '## Goal\nTest export');

    const data = await exportAsJson(testDir, PROJECT_ID);

    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].id).toBe('export-s1');
    expect(data.stats.sessionCount).toBe(1);
  });

  it('should only export observations for the specified project', async () => {
    await storeObservation({
      entityName: 'auth', type: 'decision', title: 'Project A decision',
      narrative: 'For project A', projectId: 'project-a',
    });
    await storeObservation({
      entityName: 'auth', type: 'decision', title: 'Project B decision',
      narrative: 'For project B', projectId: 'project-b',
    });

    const dataA = await exportAsJson(testDir, 'project-a');
    const dataB = await exportAsJson(testDir, 'project-b');

    expect(dataA.observations).toHaveLength(1);
    expect(dataA.observations[0].title).toBe('Project A decision');
    expect(dataB.observations).toHaveLength(1);
    expect(dataB.observations[0].title).toBe('Project B decision');
  });

  it('should export as readable Markdown', async () => {
    await storeObservation({
      entityName: 'auth', type: 'decision', title: 'Use JWT',
      narrative: 'Decided JWT for auth',
      facts: ['Expiry: 15min', 'Refresh: 7d'],
      filesModified: ['auth.ts'],
      projectId: PROJECT_ID,
    });

    const md = await exportAsMarkdown(testDir, PROJECT_ID);

    expect(md).toContain('# Memorix Export');
    expect(md).toContain('Use JWT');
    expect(md).toContain('Expiry: 15min');
    expect(md).toContain('auth.ts');
    expect(md).toContain('decision');
  });
});

describe('Import', () => {
  it('should import observations from JSON export', async () => {
    // Store and export from source
    await storeObservation({
      entityName: 'auth', type: 'decision', title: 'Use JWT',
      narrative: 'Decided JWT', projectId: PROJECT_ID,
    });
    const exported = await exportAsJson(testDir, PROJECT_ID);

    // Create a fresh target
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-import-'));
    await initObservations(targetDir);

    const result = await importFromJson(targetDir, exported);

    expect(result.observationsImported).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('should skip duplicate topicKeys on import', async () => {
    await storeObservation({
      entityName: 'auth', type: 'decision', title: 'Use JWT',
      narrative: 'Decided JWT', topicKey: 'decision/jwt',
      projectId: PROJECT_ID,
    });
    const exported = await exportAsJson(testDir, PROJECT_ID);

    // Import into same dir (which already has the topicKey)
    const result = await importFromJson(testDir, exported);

    expect(result.observationsImported).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('should import sessions', async () => {
    await startSession(testDir, PROJECT_ID, { sessionId: 'import-s1' });
    await endSession(testDir, 'import-s1', '## Goal\nSession 1');
    const exported = await exportAsJson(testDir, PROJECT_ID);

    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-import-'));
    resetObservationStore();
    resetSessionStore();
    await initObservationStore(targetDir);
    await initSessionStore(targetDir);
    await initObservations(targetDir);

    const result = await importFromJson(targetDir, exported);

    expect(result.sessionsImported).toBe(1);
  });

  it('should not duplicate sessions on re-import', async () => {
    await startSession(testDir, PROJECT_ID, { sessionId: 'dedup-s1' });
    const exported = await exportAsJson(testDir, PROJECT_ID);

    // Import into same dir
    const result = await importFromJson(testDir, exported);

    expect(result.sessionsImported).toBe(0); // already exists
  });
});
