import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildAutoProjectContext,
  formatAutoProjectContextPrompt,
} from '../../src/codegraph/auto-context.js';
import { getAllObservations, initObservations, storeObservation } from '../../src/memory/observations.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { initObservationStore, resetObservationStore } from '../../src/store/obs-store.js';
import { resetDb } from '../../src/store/orama-store.js';
import { resetSessionStore } from '../../src/store/session-store.js';
import { resetTeamStore } from '../../src/team/team-store.js';

describe('auto project context', () => {
  const originalCwd = process.cwd();
  const originalEmbedding = process.env.MEMORIX_EMBEDDING;
  let sandboxRoot = '';
  let repoDir = '';
  let dataDir = '';

  beforeEach(async () => {
    sandboxRoot = mkdtempSync(path.join(tmpdir(), 'memorix-auto-context-'));
    repoDir = path.join(sandboxRoot, 'repo');
    dataDir = path.join(sandboxRoot, 'data');
    mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    writeFileSync(path.join(repoDir, 'src', 'auth.ts'), 'export function authMiddleware(token: string) { return token.length > 0; }\n', 'utf8');
    writeFileSync(path.join(repoDir, 'src', 'worker.py'), 'def dispatch_job(name: str):\n    return name.upper()\n', 'utf8');
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    process.chdir(repoDir);
    process.env.MEMORIX_EMBEDDING = 'off';
    await initObservationStore(dataDir);
    await initObservations(dataDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalEmbedding === undefined) {
      delete process.env.MEMORIX_EMBEDDING;
    } else {
      process.env.MEMORIX_EMBEDDING = originalEmbedding;
    }
    resetObservationStore();
    resetSessionStore();
    resetTeamStore();
    await resetDb();
    closeAllDatabases();
    rmSync(sandboxRoot, { recursive: true, force: true });
  });

  it('auto-refreshes code memory and formats an agent-ready project context', async () => {
    await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'authMiddleware owns token verification',
      narrative: 'When editing login behavior, start with src/auth.ts.',
      filesModified: ['src/auth.ts'],
      projectId: 'local/repo',
    });

    const context = await buildAutoProjectContext({
      project: { id: 'local/repo', name: 'repo', rootPath: repoDir },
      dataDir,
      observations: getAllObservations(),
      refresh: 'auto',
      task: 'continue auth work',
    });

    expect(context.refresh.performed).toBe(true);
    expect(context.overview.code.files).toBe(2);
    expect(context.overview.code.languages).toEqual([
      { language: 'python', files: 1 },
      { language: 'typescript', files: 1 },
    ]);
    expect(context.overview.suggestedReads).toContain('src/auth.ts');
    expect(context.explain.sources[0]).toMatchObject({
      title: 'authMiddleware owns token verification',
      path: 'src/auth.ts',
      status: 'current',
    });

    const text = formatAutoProjectContextPrompt(context);
    expect(text).toContain('Memorix project context');
    expect(text).toContain('continue auth work');
    expect(text).toContain('src/auth.ts');
    expect(text).toContain('python 1');
    expect(text).not.toContain('SQLite');
  });
});
