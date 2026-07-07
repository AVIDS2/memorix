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
    const microDir = await createGitProjectDir('memorix-profile-micro-');
    const liteDir = await createGitProjectDir('memorix-profile-lite-');
    const teamDir = await createGitProjectDir('memorix-profile-team-');
    const fullDir = await createGitProjectDir('memorix-profile-full-');

    const { server: microServer } = await createMemorixServer(
      microDir,
      undefined,
      undefined,
      { toolProfile: 'micro' } as any,
    );
    const microTools = getToolNames(microServer as any);
    expect(microTools).toEqual([
      'memorix_codegraph_status',
      'memorix_context_pack',
      'memorix_detail',
      'memorix_project_context',
      'memorix_resolve',
      'memorix_search',
      'memorix_store',
    ]);

    const { server: liteServer } = await createMemorixServer(
      liteDir,
      undefined,
      undefined,
      { toolProfile: 'lite' } as any,
    );
    const liteTools = getToolNames(liteServer as any);
    expect(liteTools).toContain('memorix_store');
    expect(liteTools).toContain('memorix_session_start');
    expect(liteTools).toContain('memorix_graph_context');
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
    expect(teamTools).toContain('memorix_graph_context');
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
    expect(fullTools).toContain('memorix_graph_context');
  }, 30000);

  it('should keep session_start lightweight by default and require explicit joinTeam for coordination identity', async () => {
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
    expect(liteJoinText).toContain('Coordination join skipped');

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
  }, 30000);

  it('should register tools before deferred stdio runtime initialization', async () => {
    const fastDir = await createGitProjectDir('memorix-profile-fast-start-');
    const { server } = await createMemorixServer(
      fastDir,
      undefined,
      undefined,
      { toolProfile: 'lite', deferProjectRuntimeInit: true } as any,
    );

    const tools = getToolNames(server as any);
    expect(tools).toContain('memorix_codegraph_status');
    expect(tools).toContain('memorix_project_context');

    const status = await getHandler(server as any, 'memorix_codegraph_status')({});
    expect(getText(status)).toContain('"provider"');
  }, 30000);

  it('should return task-lensed project context through the MCP handler', async () => {
    const dir = await createGitProjectDir('memorix-profile-project-context-');
    await fs.writeFile(path.join(dir, 'README.md'), '# Test project\n', 'utf8');
    const { server } = await createMemorixServer(
      dir,
      undefined,
      undefined,
      { toolProfile: 'micro' } as any,
    );

    const projectContext = getHandler(server as any, 'memorix_project_context');
    const text = getText(await projectContext({ task: 'fix failing startup smoke', refresh: 'never' }));

    expect(text).toContain('Memorix Autopilot Brief');
    expect(text).toContain('Task lens: bugfix');
    expect(text).toContain('run the smallest failing test or repro first');
  }, 30000);
});
