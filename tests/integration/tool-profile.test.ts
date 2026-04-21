import { describe, it, expect, beforeEach, vi } from 'vitest';

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
import path from 'node:path';
import os from 'node:os';
import { createMemorixServer } from '../../src/server.js';
import { resetDb } from '../../src/store/orama-store.js';

let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-profile-'));
  await fs.mkdir(path.join(testDir, '.git'));
  await resetDb();
});

function getToolNames(server: any): string[] {
  return Object.keys(server._registeredTools ?? {}).sort();
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

function extractAgentId(text: string): string {
  const match = text.match(/Agent ID: (\S+)/);
  expect(match).toBeTruthy();
  return match![1];
}

async function createGitProjectDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(path.join(dir, '.git'));
  return dir;
}

describe('Tool profile registration', () => {
  it('should register built-in tools according to the selected profile', async () => {
    const liteDir = await createGitProjectDir('memorix-profile-lite-');
    const teamDir = await createGitProjectDir('memorix-profile-team-');
    const fullDir = await createGitProjectDir('memorix-profile-full-');

    const { server: liteServer } = await createMemorixServer(
      liteDir,
      undefined,
      undefined,
      { toolProfile: 'lite' } as any,
    );
    const liteTools = getToolNames(liteServer as any);
    expect(liteTools).toContain('memorix_store');
    expect(liteTools).toContain('memorix_session_start');
    expect(liteTools).not.toContain('team_manage');
    expect(liteTools).not.toContain('memorix_poll');
    expect(liteTools).not.toContain('memorix_rules_sync');
    expect(liteTools).not.toContain('create_entities');

    const { server: teamServer } = await createMemorixServer(
      teamDir,
      undefined,
      undefined,
      { toolProfile: 'team' } as any,
    );
    const teamTools = getToolNames(teamServer as any);
    expect(teamTools).toContain('team_manage');
    expect(teamTools).toContain('memorix_poll');
    expect(teamTools).toContain('memorix_dashboard');
    expect(teamTools).not.toContain('memorix_rules_sync');
    expect(teamTools).not.toContain('create_entities');

    const { server: fullServer } = await createMemorixServer(
      fullDir,
      undefined,
      undefined,
      { toolProfile: 'full' } as any,
    );
    const fullTools = getToolNames(fullServer as any);
    expect(fullTools).toContain('team_manage');
    expect(fullTools).toContain('memorix_rules_sync');
    expect(fullTools).toContain('create_entities');
  });

  it('should keep session_start lightweight by default and require explicit joinTeam for team identity', async () => {
    const liteDir = await createGitProjectDir('memorix-profile-lite-session-');
    const teamDir = await createGitProjectDir('memorix-profile-team-session-');

    const { server: liteServer } = await createMemorixServer(
      liteDir,
      undefined,
      undefined,
      { toolProfile: 'lite' } as any,
    );
    const liteStart = getHandler(liteServer as any, 'memorix_session_start');
    const liteText = getText(await liteStart({ agent: 'solo-user', agentType: 'windsurf' }));
    expect(liteText).not.toContain('Agent ID:');
    const liteJoinText = getText(await liteStart({ agent: 'solo-user', agentType: 'windsurf', joinTeam: true }));
    expect(liteJoinText).not.toContain('Agent ID:');
    expect(liteJoinText).toContain('Team join skipped');

    const { server: teamServer } = await createMemorixServer(
      teamDir,
      undefined,
      undefined,
      { toolProfile: 'team' } as any,
    );
    const teamStart = getHandler(teamServer as any, 'memorix_session_start');
    const teamStatus = getHandler(teamServer as any, 'team_manage');

    const firstText = getText(await teamStart({ agent: 'windsurf-main', agentType: 'windsurf' }));
    expect(firstText).not.toContain('Agent ID:');
    expect(getText(await teamStatus({ action: 'status' }))).toContain('No agents registered');

    const joinedText = getText(await teamStart({
      agent: 'windsurf-main',
      agentType: 'windsurf',
      joinTeam: true,
    }));
    const secondText = getText(await teamStart({
      agent: 'windsurf-main',
      agentType: 'windsurf',
      joinTeam: true,
    }));

    expect(joinedText).toContain('Agent ID:');
    expect(extractAgentId(secondText)).toBe(extractAgentId(joinedText));

    const statusText = getText(await teamStatus({ action: 'status' }));
    expect(statusText).toContain('1 active / 1 total');
  });
});
