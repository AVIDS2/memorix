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

vi.mock('../../src/config.js', () => ({
  getLLMApiKey: () => null,
  getLLMProvider: () => 'openai',
  getLLMModel: (fallback?: string) => fallback ?? 'gpt-4.1-nano',
  getLLMBaseUrl: (fallback?: string) => fallback ?? 'https://api.openai.com/v1',
}));

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemorixServer } from '../../src/server.js';
import { resetDb } from '../../src/store/orama-store.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { resetResolvedConfigCache } from '../../src/config/resolved-config.js';
import { resetTomlConfigCache } from '../../src/config/toml-loader.js';

function getHandler(server: any, name: string): (args: Record<string, unknown>) => Promise<any> {
  const handler = server._registeredTools?.[name]?.handler;
  expect(handler).toBeTypeOf('function');
  return handler;
}

function toolText(result: any): string {
  return (result?.content ?? [])
    .filter((item: any) => item?.type === 'text')
    .map((item: any) => item.text)
    .join('\n');
}

describe('long-term memory through the MCP micro profile', () => {
  const previousDataDir = process.env.MEMORIX_DATA_DIR;
  let root = '';
  let projectDir = '';
  let dataDir = '';

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-long-term-mcp-'));
    projectDir = path.join(root, 'project');
    dataDir = path.join(root, 'data');
    await fs.mkdir(path.join(projectDir, '.git'), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'long-term-mcp-test', version: '1.0.0' }));
    process.env.MEMORIX_DATA_DIR = dataDir;
    resetTomlConfigCache();
    resetResolvedConfigCache();
    resetObservationStore();
    await resetDb();
  });

  afterEach(async () => {
    if (previousDataDir === undefined) delete process.env.MEMORIX_DATA_DIR;
    else process.env.MEMORIX_DATA_DIR = previousDataDir;
    resetTomlConfigCache();
    resetResolvedConfigCache();
    resetObservationStore();
    await resetDb();
    closeAllDatabases();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('auto-qualifies an explicit store long-term memory and delivers it immediately', async () => {
    const { server, projectId } = await createMemorixServer(
      projectDir,
      undefined,
      undefined,
      { toolProfile: 'micro' } as any,
    );
    expect(Object.keys((server as any)._registeredTools ?? {})).toHaveLength(9);
    const store = getHandler(server as any, 'memorix_store');
    const projectContext = getHandler(server as any, 'memorix_project_context');
    const detail = getHandler(server as any, 'memorix_detail');

    const stored = await store({
      entityName: 'release',
      type: 'decision',
      title: 'Package smoke is required before release',
      narrative: 'Run the focused package smoke before publishing the package.',
      longTerm: {
        kind: 'procedural',
        scope: 'project',
        tags: ['release', 'package'],
        applicability: 'When publishing an npm release.',
      },
    });
    expect(stored.isError).not.toBe(true);
    // An explicit request carries its own source evidence: the record is
    // auto-qualified on the spot instead of waiting for a manual review.
    const candidateId = toolText(stored).match(/Long-term memory: ([A-Za-z0-9-]+)/)?.[1];
    expect(candidateId).toBeTruthy();

    const after = toolText(await projectContext({
      task: 'Prepare the package release and run smoke.',
      refresh: 'never',
      format: 'prompt',
    }));
    expect(after).toContain('Durable memory');
    expect(after).toContain('Package smoke is required before release');
    expect(after).toContain('durable:' + candidateId);

    const expanded = toolText(await detail({
      typedRefs: ['durable:' + candidateId],
      purpose: 'Need the full approved release procedure before publishing.',
    }));
    expect(expanded).toContain('Package smoke is required before release');
    expect(expanded).toContain('"kind": "observation"');
    expect(projectId).toBeTruthy();
  }, 30000);
});
