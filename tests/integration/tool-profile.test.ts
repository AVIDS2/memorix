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
import { CodeGraphStore } from '../../src/codegraph/store.js';
import { resetResolvedConfigCache } from '../../src/config/resolved-config.js';
import { resetTomlConfigCache } from '../../src/config/toml-loader.js';
import { storeObservation } from '../../src/memory/observations.js';
import { getProjectDataDir } from '../../src/store/persistence.js';
import { resetDb } from '../../src/store/orama-store.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

let suiteDataDir: string;
let previousSuiteDataDir: string | undefined;

beforeEach(async () => {
  previousSuiteDataDir = process.env.MEMORIX_DATA_DIR;
  suiteDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-profile-suite-data-'));
  process.env.MEMORIX_DATA_DIR = suiteDataDir;
  resetTomlConfigCache();
  resetResolvedConfigCache();
  resetObservationStore();
  closeAllDatabases();
  await resetDb();
});

afterEach(async () => {
  closeAllDatabases();
  resetObservationStore();
  await resetDb();
  resetTomlConfigCache();
  resetResolvedConfigCache();
  if (previousSuiteDataDir === undefined) {
    delete process.env.MEMORIX_DATA_DIR;
  } else {
    process.env.MEMORIX_DATA_DIR = previousSuiteDataDir;
  }
  await fs.rm(suiteDataDir, { recursive: true, force: true });
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
    expect(liteTools).not.toContain('memorix_knowledge');
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
    expect(teamTools).toContain('memorix_knowledge');
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
    expect(fullTools).toContain('memorix_knowledge');
  }, 30000);

  it('keeps reviewable Knowledge Workspace operations behind one advanced MCP tool', async () => {
    const isolatedDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-profile-knowledge-data-'));
    const previousDataDir = process.env.MEMORIX_DATA_DIR;
    process.env.MEMORIX_DATA_DIR = isolatedDataDir;
    resetTomlConfigCache();
    resetResolvedConfigCache();
    resetObservationStore();
    await resetDb();
    try {
      const dir = await createGitProjectDir('memorix-profile-knowledge-');
      const { server, projectId } = await createMemorixServer(
        dir,
        undefined,
        undefined,
        { toolProfile: 'team' } as any,
      );
      const knowledge = getHandler(server as any, 'memorix_knowledge');

      const initialized = JSON.parse(getText(await knowledge({ action: 'workspace_init', mode: 'local' })));
      expect(initialized.workspace).toMatchObject({ mode: 'local', status: 'ready' });
      expect(initialized.next).toContain('reviewable proposals');

      const status = JSON.parse(getText(await knowledge({ action: 'status', mode: 'local' })));
      expect(status.workspace).toMatchObject({ mode: 'local', publishedPages: 0, pendingProposals: [] });

      const projectDataDir = await getProjectDataDir(projectId);
      const { ClaimStore } = await import('../../src/knowledge/claim-store.js');
      const { writeClaim } = await import('../../src/knowledge/claims.js');
      const claims = new ClaimStore();
      await claims.init(projectDataDir);
      const candidate = writeClaim(claims, {
        projectId,
        subject: 'auth refresh',
        predicate: 'decision',
        objectValue: 'replace the cached authorization header',
        scope: 'project',
        reviewState: 'needs-review',
        origin: 'derived',
        evidence: [{
          evidenceKind: 'observation',
          evidenceId: 'observation:42',
          relation: 'supports',
        }],
      }).claim;

      const listed = JSON.parse(getText(await knowledge({ action: 'claim_list', mode: 'local' })));
      expect(listed.claims).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: candidate.id, reviewState: 'needs-review', evidenceCount: 1 }),
      ]));

      const reviewed = JSON.parse(getText(await knowledge({
        action: 'claim_review',
        mode: 'local',
        claimId: candidate.id,
        claimReviewState: 'approved',
        reviewDetail: 'Checked the linked observation against the current implementation.',
      })));
      expect(reviewed.claim).toMatchObject({ id: candidate.id, reviewState: 'approved' });
    } finally {
      closeAllDatabases();
      resetObservationStore();
      await resetDb();
      if (previousDataDir === undefined) {
        delete process.env.MEMORIX_DATA_DIR;
      } else {
        process.env.MEMORIX_DATA_DIR = previousDataDir;
      }
      resetTomlConfigCache();
      resetResolvedConfigCache();
      await fs.rm(isolatedDataDir, { recursive: true, force: true });
    }
  }, 30000);

  it('keeps raw graph compatibility output limited to entities and relations while persisting explicit links', async () => {
    const isolatedDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-profile-graph-data-'));
    const previousDataDir = process.env.MEMORIX_DATA_DIR;
    process.env.MEMORIX_DATA_DIR = isolatedDataDir;
    resetTomlConfigCache();
    resetResolvedConfigCache();
    resetObservationStore();
    await resetDb();
    try {
      const dir = await createGitProjectDir('memorix-profile-graph-');
      const { server } = await createMemorixServer(
        dir,
        undefined,
        undefined,
        { toolProfile: 'full' } as any,
      );
      const store = getHandler(server as any, 'memorix_store');
      const readGraph = getHandler(server as any, 'read_graph');
      await store({
        entityName: 'release-process',
        type: 'decision',
        title: 'Refresh retry replaces the cached authorization header',
        narrative: 'Refresh retry must replace the cached authorization header.',
        relatedEntities: ['token-refresh'],
      });

      const graph = JSON.parse(getText(await readGraph({})));
      expect(Object.keys(graph).sort()).toEqual(['entities', 'relations']);
      expect(graph.relations).toEqual(expect.arrayContaining([
        { from: 'release-process', to: 'token-refresh', relationType: 'related_entity' },
      ]));
    } finally {
      closeAllDatabases();
      resetObservationStore();
      await resetDb();
      if (previousDataDir === undefined) {
        delete process.env.MEMORIX_DATA_DIR;
      } else {
        process.env.MEMORIX_DATA_DIR = previousDataDir;
      }
      resetTomlConfigCache();
      resetResolvedConfigCache();
      await fs.rm(isolatedDataDir, { recursive: true, force: true });
    }
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

    const deliveryJson = getText(await projectContext({
      task: 'fix failing startup smoke',
      refresh: 'never',
      format: 'json',
      deliveryProfile: 'no-semantic-code',
    }));
    const delivery = JSON.parse(deliveryJson).delivery;
    expect(delivery.profile).toBe('no-semantic-code');
    expect(delivery.suppressed).toEqual(['semantic-code']);
  }, 30000);

  it('should apply CodeGraph exclude patterns to the MCP context pack handler', async () => {
    const dir = await createGitProjectDir('memorix-profile-context-pack-exclude-');
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-profile-context-pack-data-'));
    const previousDataDir = process.env.MEMORIX_DATA_DIR;
    process.env.MEMORIX_DATA_DIR = dataDir;
    resetTomlConfigCache();
    resetResolvedConfigCache();

    try {
      await fs.writeFile(path.join(dir, 'memorix.toml'), [
        '[codegraph]',
        'exclude_patterns = ["vendor/**"]',
      ].join('\n'), 'utf8');

      const { server, projectId } = await createMemorixServer(
        dir,
        undefined,
        undefined,
        { toolProfile: 'micro' } as any,
      );
      const projectDataDir = await getProjectDataDir(projectId);
      const codeStore = new CodeGraphStore();
      await codeStore.init(projectDataDir);
      const indexedAt = '2026-07-07T00:00:00.000Z';
      codeStore.upsertFiles([
        {
          id: 'file:vendor-cache',
          projectId,
          path: 'vendor/cache/tool.ts',
          contentHash: 'vendor-cache-hash',
          indexedAt,
        },
        {
          id: 'file:auth',
          projectId,
          path: 'src/auth.ts',
          contentHash: 'auth-hash',
          indexedAt,
        },
      ]);

      await storeObservation({
        entityName: 'cache',
        type: 'decision',
        title: 'Vendor cache decision',
        narrative: 'Keep vendor/cache/tool.ts for cache behavior.',
        filesModified: ['vendor/cache/tool.ts'],
        projectId,
      });
      await storeObservation({
        entityName: 'auth',
        type: 'decision',
        title: 'Auth source decision',
        narrative: 'Keep src/auth.ts for auth behavior.',
        filesModified: ['src/auth.ts'],
        projectId,
      });

      const contextPack = getHandler(server as any, 'memorix_context_pack');
      const text = getText(await contextPack({ task: 'continue auth cache bug' }));

      expect(text).toContain('Auth source decision');
      expect(text).toContain('src/auth.ts');
      expect(text).not.toContain('Vendor cache decision');
      expect(text).not.toContain('vendor/cache/tool.ts');
    } finally {
      if (previousDataDir === undefined) {
        delete process.env.MEMORIX_DATA_DIR;
      } else {
        process.env.MEMORIX_DATA_DIR = previousDataDir;
      }
      resetTomlConfigCache();
      resetResolvedConfigCache();
      resetObservationStore();
      await resetDb();
      closeAllDatabases();
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  }, 30000);
});
