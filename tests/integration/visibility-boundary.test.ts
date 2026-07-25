import { describe, expect, it, vi } from 'vitest';

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

function text(result: any): string {
  return (result?.content ?? [])
    .filter((item: any) => item?.type === 'text')
    .map((item: any) => item.text)
    .join('\n');
}

function agentId(result: any): string {
  const match = text(result).match(/Agent ID: (\S+)/);
  expect(match).toBeTruthy();
  return match![1];
}

describe('MCP observation visibility boundary', () => {
  it('keeps a targeted handoff readable only by its sender and recipient', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-visibility-data-'));
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-visibility-project-'));
    const previousDataDir = process.env.MEMORIX_DATA_DIR;
    process.env.MEMORIX_DATA_DIR = dataDir;
    await fs.mkdir(path.join(projectDir, '.git'));
    resetTomlConfigCache();
    resetResolvedConfigCache();
    resetObservationStore();
    await resetDb();

    try {
      const first = await createMemorixServer(projectDir, undefined, undefined, { toolProfile: 'team' } as any);
      const second = await createMemorixServer(projectDir, undefined, undefined, { toolProfile: 'team' } as any);
      const third = await createMemorixServer(projectDir, undefined, undefined, { toolProfile: 'team' } as any);

      const startA = getHandler(first.server as any, 'memorix_session_start');
      const startB = getHandler(second.server as any, 'memorix_session_start');
      const startC = getHandler(third.server as any, 'memorix_session_start');
      const idA = agentId(await startA({ agent: 'visibility-a', agentType: 'codex', joinTeam: true }));
      const idB = agentId(await startB({ agent: 'visibility-b', agentType: 'claude-code', joinTeam: true }));
      agentId(await startC({ agent: 'visibility-c', agentType: 'windsurf', joinTeam: true }));

      const handoffA = getHandler(first.server as any, 'memorix_handoff');
      const created = await handoffA({
        fromAgentId: idA,
        toAgentId: idB,
        taskId: 'visibility-task',
        summary: 'Targeted visibility handoff',
        context: 'Only the recipient should be able to retrieve this context.',
      });
      expect(created.isError).not.toBe(true);
      const idMatch = text(created).match(/Observation: #(\d+)/);
      expect(idMatch).toBeTruthy();
      const handoffId = Number(idMatch![1]);

      const searchB = getHandler(second.server as any, 'memorix_search');
      const searchC = getHandler(third.server as any, 'memorix_search');
      expect(text(await searchB({ query: 'Targeted visibility handoff' }))).toContain('Targeted visibility handoff');
      expect(text(await searchC({ query: 'Targeted visibility handoff' }))).not.toContain('Targeted visibility handoff');

      const detailB = getHandler(second.server as any, 'memorix_detail');
      const detailC = getHandler(third.server as any, 'memorix_detail');
      expect(text(await detailB({ ids: [handoffId] }))).toContain('Only the recipient should be able to retrieve this context.');
      expect(text(await detailC({ ids: [handoffId] }))).not.toContain('Only the recipient should be able to retrieve this context.');

      // New memories default to project visibility, but an upsert must not turn
      // an existing targeted handoff public simply because visibility is omitted.
      const ownerUpdate = await getHandler(first.server as any, 'memorix_store')({
        entityName: 'team-handoff',
        type: 'session-request',
        title: 'Updated targeted visibility handoff',
        narrative: 'The sender can update the handoff without changing who can read it.',
        topicKey: `handoff:visibility-task:${idA}`,
      });
      expect(ownerUpdate.isError).not.toBe(true);
      expect(text(await searchB({ query: 'Updated targeted visibility handoff' }))).toContain('Updated targeted visibility handoff');
      expect(text(await searchC({ query: 'Updated targeted visibility handoff' }))).not.toContain('Updated targeted visibility handoff');

      const overwrite = await getHandler(third.server as any, 'memorix_store')({
        entityName: 'team-handoff',
        type: 'decision',
        title: 'Overwrite targeted handoff',
        narrative: 'A third agent must not be able to mutate a targeted handoff by guessing its topic key.',
        topicKey: `handoff:visibility-task:${idA}`,
      });
      expect(overwrite.isError).toBe(true);
      expect(text(overwrite)).toContain('write scope');

      const forged = await getHandler(second.server as any, 'memorix_handoff')({
        fromAgentId: idA,
        summary: 'Forged sender',
        context: 'This must fail.',
      });
      expect(forged.isError).toBe(true);
      expect(text(forged)).toContain('must match');
    } finally {
      if (previousDataDir === undefined) delete process.env.MEMORIX_DATA_DIR;
      else process.env.MEMORIX_DATA_DIR = previousDataDir;
      resetTomlConfigCache();
      resetResolvedConfigCache();
      resetObservationStore();
      await resetDb();
      closeAllDatabases();
      await fs.rm(dataDir, { recursive: true, force: true });
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  }, 90_000);
});
