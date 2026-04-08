/**
 * SessionStore route integration test
 *
 * Proves the /sessions route logic (as used in serve-http.ts) returns
 * correct results from the SQLite canonical store, NOT from sessions.json.
 *
 * This mirrors the exact code path:
 *   initSessionStore(dataDir) → getSessionStore().loadByProject(projectId)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initSessionStore, getSessionStore, resetSessionStore } from '../../src/store/session-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-session-route-'));
  resetSessionStore();
});

afterEach(async () => {
  resetSessionStore();
  closeAllDatabases();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('SessionStore route (/sessions equivalent)', () => {
  it('should return sessions by project from SQLite store', async () => {
    await initSessionStore(tmpDir);
    const store = getSessionStore();
    expect(store.getBackendName()).toBe('sqlite');

    // Insert sessions for two projects
    await store.insert({
      id: 'sess-a1',
      projectId: 'org/project-a',
      startedAt: new Date().toISOString(),
      status: 'completed',
      summary: 'Session A1',
      agent: 'cursor',
    });
    await store.insert({
      id: 'sess-a2',
      projectId: 'org/project-a',
      startedAt: new Date().toISOString(),
      status: 'active',
      agent: 'windsurf',
    });
    await store.insert({
      id: 'sess-b1',
      projectId: 'org/project-b',
      startedAt: new Date().toISOString(),
      status: 'active',
      agent: 'codex',
    });

    // Exact same call as the /sessions route in serve-http.ts
    const projectASessions = await getSessionStore().loadByProject('org/project-a');
    expect(projectASessions).toHaveLength(2);
    expect(projectASessions.map(s => s.id).sort()).toEqual(['sess-a1', 'sess-a2']);
    expect(projectASessions.every(s => s.projectId === 'org/project-a')).toBe(true);

    const projectBSessions = await getSessionStore().loadByProject('org/project-b');
    expect(projectBSessions).toHaveLength(1);
    expect(projectBSessions[0].id).toBe('sess-b1');
  });

  it('should return empty array for unknown project', async () => {
    await initSessionStore(tmpDir);
    const result = await getSessionStore().loadByProject('nonexistent/project');
    expect(result).toEqual([]);
  });

  it('should NOT read from sessions.json (canonical is SQLite)', async () => {
    // Write sessions to JSON file (legacy path)
    await fs.writeFile(
      path.join(tmpDir, 'sessions.json'),
      JSON.stringify([
        { id: 'json-only', projectId: 'org/legacy', startedAt: new Date().toISOString(), status: 'active' },
      ]),
    );

    // Init store — migration will pull JSON data into SQLite on first init
    await initSessionStore(tmpDir);

    // The migrated session should be accessible
    const migrated = await getSessionStore().loadByProject('org/legacy');
    expect(migrated).toHaveLength(1);
    expect(migrated[0].id).toBe('json-only');

    // Now add a session directly to JSON (simulating external write)
    const raw = JSON.parse(await fs.readFile(path.join(tmpDir, 'sessions.json'), 'utf-8'));
    raw.push({ id: 'sneaky-json', projectId: 'org/legacy', startedAt: new Date().toISOString(), status: 'active' });
    await fs.writeFile(path.join(tmpDir, 'sessions.json'), JSON.stringify(raw));

    // SQLite store should NOT see the sneaky JSON addition
    const afterSneak = await getSessionStore().loadByProject('org/legacy');
    expect(afterSneak).toHaveLength(1); // Still 1, not 2
    expect(afterSneak[0].id).toBe('json-only');
  });

  it('should persist sessions across store re-init (SQLite durability)', async () => {
    await initSessionStore(tmpDir);
    await getSessionStore().insert({
      id: 'durable-1',
      projectId: 'org/durable',
      startedAt: new Date().toISOString(),
      status: 'completed',
      summary: 'Should survive re-init',
    });

    // Reset and re-init (simulates server restart)
    resetSessionStore();
    await initSessionStore(tmpDir);

    const sessions = await getSessionStore().loadByProject('org/durable');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('durable-1');
    expect(sessions[0].summary).toBe('Should survive re-init');
  });
});
