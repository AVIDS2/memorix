import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startSession, endSession } from '../../src/memory/session.js';
import { initSessionStore, getSessionStore, resetSessionStore } from '../../src/store/session-store.js';
import { initObservations } from '../../src/memory/observations.js';
import { initObservationStore, resetObservationStore } from '../../src/store/obs-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

/**
 * Session churn stress exam: rapid start/end cycles across projects must
 * keep one active session per project alias set, complete summaries, and no
 * cross-project contamination. Deterministic, offline.
 */

const PROJECTS = ['stress/session-a', 'stress/session-b', 'stress/session-c'];
const CYCLES_PER_PROJECT = 15;
let sandbox = '';

describe('session churn stress exam', () => {
  beforeEach(() => {
    sandbox = mkdtempSync(path.join(tmpdir(), 'memorix-stress-session-'));
    process.env.MEMORIX_EMBEDDING = 'off';
  });

  afterEach(async () => {
    resetObservationStore();
    resetSessionStore();
    closeAllDatabases();
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
    sandbox = '';
  });

  it('survives rapid start/end churn across three projects', async () => {
    const dataDir = path.join(sandbox, 'data');
    await initObservationStore(dataDir);
    await initObservations(dataDir);
    await initSessionStore(dataDir);

    for (const projectId of PROJECTS) {
      for (let cycle = 0; cycle < CYCLES_PER_PROJECT; cycle++) {
        const started = await startSession(path.join(sandbox, 'data'), projectId, { agent: 'stress-agent' });
        expect(started.session.id).toBeTruthy();
        const ended = await endSession(
          path.join(sandbox, 'data'),
          started.session.id,
          `Cycle ${cycle}: goal, decisions, next steps.`,
        );
        expect(ended?.status).toBe('completed');
        expect(ended?.summary).toContain(`Cycle ${cycle}`);
      }
    }

    for (const projectId of PROJECTS) {
      const sessions = await getSessionStore().loadByProject(projectId);
      expect(sessions.length, projectId).toBe(CYCLES_PER_PROJECT);
      expect(sessions.every((session) => session.projectId === projectId)).toBe(true);
      expect(sessions.filter((session) => session.status === 'active').length).toBeLessThanOrEqual(1);
      expect(sessions.every((session) => typeof session.summary === 'string' && session.summary.length > 0)).toBe(true);
    }
  }, 90_000);

  it('leaves at most one active session per project after parallel starts', async () => {
    const dataDir = path.join(sandbox, 'data');
    await initObservationStore(dataDir);
    await initObservations(dataDir);
    await initSessionStore(dataDir);
    const projectId = 'stress/session-parallel';

    await Promise.all(
      Array.from({ length: 10 }, () => startSession(path.join(sandbox, 'data'), projectId, { agent: 'stress-agent' })),
    );

    const sessions = await getSessionStore().loadByProject(projectId);
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.filter((session) => session.status === 'active').length, 'atomic rollover must win races').toBeLessThanOrEqual(1);
  }, 60_000);
});
