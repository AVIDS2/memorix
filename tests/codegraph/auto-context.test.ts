import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildAutoProjectContext,
  formatAutoProjectContextPrompt,
} from '../../src/codegraph/auto-context.js';
import { CodeGraphStore } from '../../src/codegraph/store.js';
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
    expect(context.overview.suggestedReads.length).toBeLessThanOrEqual(8);
    expect(context.explain.sources[0]).toMatchObject({
      title: 'authMiddleware owns token verification',
      path: 'src/auth.ts',
      status: 'current',
    });

    const text = formatAutoProjectContextPrompt(context);
    expect(text).toContain('Memorix Autopilot Brief');
    expect(text).toContain('Start here');
    expect(text).toContain('Reliable memory');
    expect(text).toContain('How to use this');
    expect(text).toContain('continue auth work');
    expect(text).toContain('src/auth.ts');
    expect(text).toContain('python 1');
    expect(text).not.toContain('SQLite');
  });

  it('collects the project graph once per context request', async () => {
    const store = new CodeGraphStore();
    await store.init(dataDir);
    store.replaceProjectIndex('local/repo', {
      files: [],
      symbols: [],
      edges: [],
    });
    const listProjectObservationRefs = vi.spyOn(CodeGraphStore.prototype, 'listProjectObservationRefs');
    const listReferencedSymbols = vi.spyOn(CodeGraphStore.prototype, 'listReferencedSymbols');

    await buildAutoProjectContext({
      project: { id: 'local/repo', name: 'repo', rootPath: repoDir },
      dataDir,
      observations: getAllObservations(),
      refresh: 'never',
      task: 'inspect project context performance',
    });

    expect(listProjectObservationRefs).toHaveBeenCalledTimes(1);
    expect(listReferencedSymbols).toHaveBeenCalledTimes(1);
  });

  it('puts current project facts ahead of stale progress notes', async () => {
    mkdirSync(path.join(repoDir, 'docs', 'memcode', 'dev-log'), { recursive: true });
    writeFileSync(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ name: 'repo', version: '9.9.9' }, null, 2),
      'utf8',
    );
    writeFileSync(
      path.join(repoDir, 'CHANGELOG.md'),
      '# Changelog\n\n## [9.9.9] - 2026-07-02\n\n### Fixed\n- Current release facts.\n',
      'utf8',
    );
    writeFileSync(
      path.join(repoDir, 'docs', 'memcode', 'dev-log', 'progress.txt'),
      [
        '# memcode Development Progress',
        '',
        '> Auto-updated by agent. New sessions: read this file first.',
        '',
        '## Current State',
        '- **Phase**: Release hardening',
        '- **Branch**: feat/memcode-agent',
        '- **Last updated**: 2026-06-18',
        '',
      ].join('\n'),
      'utf8',
    );

    const context = await buildAutoProjectContext({
      project: { id: 'local/repo', name: 'repo', rootPath: repoDir },
      dataDir,
      observations: getAllObservations(),
      refresh: 'auto',
      task: 'continue release work',
      now: new Date('2026-07-02T12:00:00Z'),
    });

    expect(context.currentFacts.packageVersion).toBe('9.9.9');
    expect(context.currentFacts.latestChangelog).toEqual({ version: '9.9.9', date: '2026-07-02' });
    expect(context.currentFacts.staleNotes[0]).toMatchObject({
      path: 'docs/memcode/dev-log/progress.txt',
      lastUpdated: '2026-06-18',
      branchHint: 'feat/memcode-agent',
    });

    const text = formatAutoProjectContextPrompt(context);
    expect(text).toContain('Current project facts');
    expect(text).toContain('Package version: 9.9.9');
    expect(text).toContain('Latest changelog: 9.9.9 (2026-07-02)');
    expect(text).toContain('Historical/stale project notes');
    expect(text).toContain('docs/memcode/dev-log/progress.txt');
    expect(text).toContain('feat/memcode-agent');
    expect(text).toContain('Current facts above outrank progress/dev-log files when they conflict.');
    expect(text.indexOf('Current project facts')).toBeLessThan(text.indexOf('Start here'));
  });

  it('shapes bugfix tasks toward failing tests and focused verification', async () => {
    mkdirSync(path.join(repoDir, 'tests'), { recursive: true });
    writeFileSync(
      path.join(repoDir, 'tests', 'auth.test.ts'),
      "import { authMiddleware } from '../src/auth';\nit('rejects empty tokens', () => expect(authMiddleware('')).toBe(false));\n",
      'utf8',
    );
    await storeObservation({
      entityName: 'auth',
      type: 'gotcha',
      title: 'auth regression is covered by auth.test.ts',
      narrative: 'When fixing auth regressions, reproduce the failing auth test before changing middleware.',
      filesModified: ['tests/auth.test.ts'],
      projectId: 'local/repo',
    });
    await storeObservation({
      entityName: 'auth',
      type: 'decision',
      title: 'authMiddleware owns token verification',
      narrative: 'Auth fixes usually land in src/auth.ts.',
      filesModified: ['src/auth.ts'],
      projectId: 'local/repo',
    });

    const context = await buildAutoProjectContext({
      project: { id: 'local/repo', name: 'repo', rootPath: repoDir },
      dataDir,
      observations: getAllObservations(),
      refresh: 'auto',
      task: 'fix failing auth regression test',
    });

    const text = formatAutoProjectContextPrompt(context);
    expect(text).toContain('Task lens: bugfix');
    expect(text).toContain('run the smallest failing test or repro first');
    expect(text.indexOf('tests/auth.test.ts')).toBeLessThan(text.indexOf('src/auth.ts'));
  });

  it('shapes release tasks toward package metadata, changelog, and build verification', async () => {
    writeFileSync(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ name: 'repo', version: '1.1.7', scripts: { build: 'tsc' } }, null, 2),
      'utf8',
    );
    writeFileSync(
      path.join(repoDir, 'CHANGELOG.md'),
      '# Changelog\n\n## [1.1.7] - 2026-07-07\n\n### Changed\n- Task-lensed briefs.\n',
      'utf8',
    );

    const context = await buildAutoProjectContext({
      project: { id: 'local/repo', name: 'repo', rootPath: repoDir },
      dataDir,
      observations: getAllObservations(),
      refresh: 'auto',
      task: 'prepare 1.1.7 release',
      now: new Date('2026-07-07T12:00:00Z'),
    });

    const text = formatAutoProjectContextPrompt(context);
    expect(text).toContain('Task lens: release');
    expect(text).toContain('Package version: 1.1.7');
    expect(text).toContain('CHANGELOG.md');
    expect(text).toContain('package.json');
    expect(text).toContain('run build, tests, package smoke, and publish dry-run where available');
    expect(text.indexOf('Current project facts')).toBeLessThan(text.indexOf('Start here'));
  });

  it('shapes onboarding tasks toward docs and hides unrelated suspect details', async () => {
    writeFileSync(path.join(repoDir, 'README.md'), '# Repo\n\nStart with this overview.\n', 'utf8');
    await storeObservation({
      entityName: 'auth',
      type: 'gotcha',
      title: 'authMiddleware bug workaround changed login flow',
      narrative: 'This old auth workaround is unrelated to onboarding.',
      filesModified: ['src/auth.ts'],
      projectId: 'local/repo',
    });

    await buildAutoProjectContext({
      project: { id: 'local/repo', name: 'repo', rootPath: repoDir },
      dataDir,
      observations: getAllObservations(),
      refresh: 'auto',
      task: 'fix auth bug',
    });
    writeFileSync(path.join(repoDir, 'src', 'auth.ts'), 'export function authMiddleware(token: string) { return token.trim().length > 0; }\n', 'utf8');

    const context = await buildAutoProjectContext({
      project: { id: 'local/repo', name: 'repo', rootPath: repoDir },
      dataDir,
      observations: getAllObservations(),
      refresh: 'always',
      task: 'understand and onboard onto this project',
    });

    const text = formatAutoProjectContextPrompt(context);
    expect(text).toContain('Task lens: onboarding');
    expect(text).toContain('README.md');
    expect(text).toContain('1 suspect');
    expect(text).toContain('Only task-relevant warning details are shown.');
    expect(text).not.toContain('authMiddleware bug workaround changed login flow');
  });

  it('keeps explicitly mentioned suspect source details visible under onboarding', async () => {
    writeFileSync(path.join(repoDir, 'README.md'), '# Repo\n\nStart with this overview.\n', 'utf8');
    await storeObservation({
      entityName: 'auth',
      type: 'gotcha',
      title: 'authMiddleware changed login flow',
      narrative: 'Inspect src/auth.ts before relying on the old auth behavior.',
      filesModified: ['src/auth.ts'],
      projectId: 'local/repo',
    });

    await buildAutoProjectContext({
      project: { id: 'local/repo', name: 'repo', rootPath: repoDir },
      dataDir,
      observations: getAllObservations(),
      refresh: 'auto',
      task: 'fix auth bug',
    });
    writeFileSync(path.join(repoDir, 'src', 'auth.ts'), 'export function authMiddleware(token: string) { return token.trim().length > 0; }\n', 'utf8');

    const context = await buildAutoProjectContext({
      project: { id: 'local/repo', name: 'repo', rootPath: repoDir },
      dataDir,
      observations: getAllObservations(),
      refresh: 'always',
      task: 'understand src/auth.ts before onboarding',
    });

    const text = formatAutoProjectContextPrompt(context);
    expect(text).toContain('Task lens: onboarding');
    expect(text).toContain('#1 suspect: authMiddleware changed login flow');
  });

  it('classifies plural test tasks as test lens instead of feature lens', async () => {
    const context = await buildAutoProjectContext({
      project: { id: 'local/repo', name: 'repo', rootPath: repoDir },
      dataDir,
      observations: getAllObservations(),
      refresh: 'auto',
      task: 'add tests for auth',
    });

    const text = formatAutoProjectContextPrompt(context);
    expect(text).toContain('Task lens: test');
    expect(text).toContain('run the exact focused test file or test name first');
  });
});
