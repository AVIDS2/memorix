import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createMemorixServer } from '../../src/server.js';
import { resetDb } from '../../src/store/orama-store.js';

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
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-nested-home-'));
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  await resetDb();
});

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
});

describe('memorix_session_start nested-subdir binding', () => {
  it('keeps the parent repo bound when projectRoot is already the current project', async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-nested-work-'));
    const parent = path.join(work, 'parent');
    await fs.mkdir(parent, { recursive: true });
    await createFakeGitRepo(parent, 'https://github.com/AVIDS2/parent-repo.git');

    const nested = path.join(parent, 'nested-pkg');
    await fs.mkdir(nested, { recursive: true });
    await createFakeGitRepo(nested);

    const { server } = await createMemorixServer(parent);
    const sessionStart = getHandler(server as any, 'memorix_session_start');
    const text = getText(await sessionStart({ projectRoot: parent, agent: 'cc' }));

    expect(text).toContain('AVIDS2/parent-repo');
    expect(text).not.toContain('local/nested-pkg');
  });
});
