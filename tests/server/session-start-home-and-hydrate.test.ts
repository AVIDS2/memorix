import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: async () => null,
  isVectorSearchAvailable: async () => false,
  isEmbeddingExplicitlyDisabled: () => true,
  resetProvider: () => {},
}));

vi.mock('../../src/llm/provider.js', () => ({
  initLLM: () => null,
  isLLMEnabled: () => false,
  getLLMConfig: () => null,
  setLLMConfig: () => {},
}));

import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createMemorixServer } from '../../src/server.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { resetSessionStore } from '../../src/store/session-store.js';
import { resetDb } from '../../src/store/orama-store.js';
import { SqliteBackend } from '../../src/store/sqlite-store.js';

let tempHome: string;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

async function createFakeGitRepo(root: string, remote?: string): Promise<void> {
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  const config = remote ? `[remote "origin"]\n\turl = ${remote}\n` : '';
  await fs.writeFile(path.join(root, '.git', 'config'), config, 'utf8');
}

function getHandler(server: any, name: string): (args: Record<string, unknown>) => Promise<any> {
  const handler = server._registeredTools?.[name]?.handler;
  expect(handler).toBeTypeOf('function');
  return handler;
}

function getText(result: any): string {
  return (result?.content ?? [])
    .filter((item: any) => item?.type === 'text')
    .map((item: any) => item.text)
    .join('\n');
}

beforeEach(async () => {
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-session-home-'));
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  resetObservationStore();
  resetSessionStore();
  await resetDb();
});

afterEach(async () => {
  resetObservationStore();
  resetSessionStore();
  closeAllDatabases();
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  await fs.rm(tempHome, { recursive: true, force: true });
});

describe('memorix_session_start home bind and hydrate', () => {
  it('refuses $HOME as projectRoot and does not create ~/memorix.db', async () => {
    const { server } = await createMemorixServer(tempHome, undefined, undefined, {
      allowUntrackedFallback: false,
      deferProjectInitUntilBound: true,
      deferProjectRuntimeInit: true,
    });
    const sessionStart = getHandler(server as any, 'memorix_session_start');
    const result = await sessionStart({ projectRoot: tempHome, agent: 'cursor' });

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Refusing to bind $HOME');
    expect(existsSync(path.join(tempHome, 'memorix.db'))).toBe(false);
  });

  it('binds a git project without loadAll() of the observation corpus', async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-session-work-'));
    const project = path.join(work, 'app');
    await fs.mkdir(project, { recursive: true });
    await createFakeGitRepo(project, 'https://github.com/AVIDS2/session-fast.git');

    const { server } = await createMemorixServer(tempHome, undefined, undefined, {
      allowUntrackedFallback: false,
      deferProjectInitUntilBound: true,
      deferProjectRuntimeInit: true,
    });
    let releaseLoadAll: (() => void) | undefined;
    const loadAllBlocked = new Promise<void>((resolve) => {
      releaseLoadAll = resolve;
    });
    const loadAll = vi.spyOn(SqliteBackend.prototype, 'loadAll').mockImplementation(async () => {
      await loadAllBlocked;
      return [];
    });
    const sessionStart = getHandler(server as any, 'memorix_session_start');
    const started = Date.now();
    const text = getText(await sessionStart({ projectRoot: project, agent: 'cursor' }));
    const elapsedMs = Date.now() - started;

    expect(text).toContain('AVIDS2/session-fast');
    expect(text).toContain('Session started');
    expect(elapsedMs).toBeLessThan(5_000);
    expect(existsSync(path.join(tempHome, 'memorix.db'))).toBe(false);
    releaseLoadAll?.();

    loadAll.mockRestore();
    await fs.rm(work, { recursive: true, force: true });
  });
});
