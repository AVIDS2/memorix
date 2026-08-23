/**
 * Dashboard Project-Scope Integration Tests
 *
 * Covers the 4 confirmed high-priority bugs:
 * 1. Standalone dashboard /graph returns global graph (should be project-filtered)
 * 2. Standalone dashboard /export includes global graph (should be project-filtered)
 * 3. Standalone dashboard DELETE /api/observations/:id allows cross-project deletion
 * 4. Embedded serve-http /api/config?project= ignores the project parameter
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getObservationStore, resetObservationStore } from '../../src/store/obs-store.js';
import { initTeamStore, resetTeamStore } from '../../src/team/team-store.js';
import { resetProvider } from '../../src/embedding/provider.js';
import { resetConfigCache } from '../../src/config.js';
import { resetDotenv } from '../../src/config/dotenv-loader.js';

// ── Test setup ────────────────────────────────────────────────────

const DASH_PORT = 14210;
const DASH_BASE = `http://127.0.0.1:${DASH_PORT}`;

let tempDir: string;
let dataDir: string;
let dashboardServer: Server | null = null;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const EMBEDDING_ENV_KEYS = [
  'MEMORIX_EMBEDDING',
  'MEMORIX_EMBEDDING_API_KEY',
  'MEMORIX_EMBEDDING_BASE_URL',
  'MEMORIX_EMBEDDING_MODEL',
  'MEMORIX_EMBEDDING_DIMENSIONS',
];
let savedEmbeddingEnv: Record<string, string | undefined> = {};

function forceEmbeddingOffForTest(): void {
  savedEmbeddingEnv = {};
  for (const key of EMBEDDING_ENV_KEYS) {
    savedEmbeddingEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.MEMORIX_EMBEDDING = 'off';
  resetConfigCache();
  resetProvider();
}

function restoreEmbeddingEnv(): void {
  resetProvider();
  for (const key of EMBEDDING_ENV_KEYS) {
    if (savedEmbeddingEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEmbeddingEnv[key];
    }
  }
  resetConfigCache();
}

async function fetchJson(urlPath: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${DASH_BASE}${urlPath}`, init);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ── Standalone Dashboard Tests ────────────────────────────────────

describe('Standalone Dashboard Project Scope', () => {
  const PROJECT_A = 'test-org/project-a';
  const PROJECT_B = 'test-org/project-b';

  beforeAll(async () => {
    forceEmbeddingOffForTest();

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-dash-test-'));
    dataDir = path.join(tempDir, '.memorix', 'data');
    await fs.mkdir(dataDir, { recursive: true });

    // Override home so getBaseDataDir resolves to our temp
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;

    // Seed observations for two projects
    const observations = [
      { id: 1, entityName: 'auth-module', type: 'decision', title: 'Use JWT', narrative: 'Chose JWT for auth', facts: [], relatedEntities: ['token-refresh'], projectId: PROJECT_A, status: 'active', createdAt: new Date().toISOString() },
      { id: 2, entityName: 'auth-module', type: 'gotcha', title: 'Token expiry', narrative: 'Tokens expire silently', facts: [], projectId: PROJECT_A, status: 'active', createdAt: new Date().toISOString() },
      { id: 3, entityName: 'billing-service', type: 'decision', title: 'Use Stripe', narrative: 'Chose Stripe for billing', facts: [], projectId: PROJECT_B, status: 'active', createdAt: new Date().toISOString() },
      { id: 4, entityName: 'billing-service', type: 'problem-solution', title: 'Webhook retry', narrative: 'Fixed webhook retries', facts: [], projectId: PROJECT_B, status: 'active', createdAt: new Date().toISOString() },
      { id: 5, entityName: 'auth-module', type: 'session-request', title: 'Old handoff', narrative: 'Superseded request', facts: [], projectId: PROJECT_A, status: 'resolved', createdAt: new Date().toISOString() },
      { id: 6, entityName: 'billing-service', type: 'session-request', title: 'Archived note', narrative: 'No longer current', facts: [], projectId: PROJECT_B, status: 'resolved', createdAt: new Date().toISOString() },
      { id: 7, entityName: 'auth-module', type: 'session-request', title: 'Private handoff', narrative: 'Only the owning agent may inspect this.', facts: [], projectId: PROJECT_A, status: 'active', visibility: 'personal', createdByAgentId: 'private-agent', createdAt: new Date().toISOString() },
    ];
    await fs.writeFile(path.join(dataDir, 'observations.json'), JSON.stringify(observations));
    await fs.writeFile(path.join(dataDir, 'counter.json'), JSON.stringify({ nextId: 8 }));

    // Seed graph with entities from both projects
    const graphLines = [
      JSON.stringify({ type: 'entity', name: 'auth-module', entityType: 'module', observations: ['[#1] Use JWT', '[#2] Token expiry'] }),
      JSON.stringify({ type: 'entity', name: 'token-refresh', entityType: 'related', observations: [] }),
      JSON.stringify({ type: 'entity', name: 'billing-service', entityType: 'service', observations: ['[#3] Use Stripe', '[#4] Webhook retry'] }),
      JSON.stringify({ type: 'relation', from: 'auth-module', to: 'token-refresh', relationType: 'related_entity' }),
      JSON.stringify({ type: 'relation', from: 'auth-module', to: 'billing-service', relationType: 'depends-on' }),
    ];
    await fs.writeFile(path.join(dataDir, 'graph.jsonl'), graphLines.join('\n') + '\n');

    // Seed empty sessions
    await fs.writeFile(path.join(dataDir, 'sessions.json'), '[]');

    const teamStore = await initTeamStore(dataDir);
    const agent = teamStore.registerAgent({
      projectId: PROJECT_A,
      agentType: 'codex',
      instanceId: 'dashboard-agent',
      name: 'autonomous-codex',
      role: 'engineer',
    });
    teamStore.createTask({
      projectId: PROJECT_A,
      description: 'Run autonomous release checks',
      createdBy: agent.agent_id,
      requiredRole: 'engineer',
    });
    teamStore.acquireLock(PROJECT_A, 'src/release.ts', agent.agent_id);
    resetTeamStore();

    // Start the standalone dashboard
    const { startDashboard } = await import('../../src/dashboard/server.js');

    await new Promise<void>((resolve, reject) => {
      // startDashboard returns a promise that resolves when server is listening
      startDashboard(dataDir, DASH_PORT, path.join(tempDir, 'static'), PROJECT_A, 'project-a', false)
        .then(() => resolve())
        .catch(reject);
    });
  }, 15_000);

  afterAll(async () => {
    resetObservationStore();
    resetTeamStore();
    restoreEmbeddingEnv();
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    // The dashboard server doesn't expose a close method, but the process cleanup will handle it
    try { await fs.rm(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  // ── Bug 1: /graph should be project-filtered ──

  it('GET /api/graph returns only entities for the current project', async () => {
    const { status, body } = await fetchJson('/api/graph');
    expect(status).toBe(200);

    const entityNames = body.entities.map((e: any) => e.name);
    // Project A has auth-module, NOT billing-service
    expect(entityNames).toContain('auth-module');
    expect(entityNames).toContain('token-refresh');
    expect(entityNames).not.toContain('billing-service');
  });

  it('GET /api/graph?project=... filters to the requested project', async () => {
    const { status, body } = await fetchJson(`/api/graph?project=${encodeURIComponent(PROJECT_B)}`);
    expect(status).toBe(200);

    const entityNames = body.entities.map((e: any) => e.name);
    // Project B has billing-service, NOT auth-module
    expect(entityNames).toContain('billing-service');
    expect(entityNames).not.toContain('auth-module');
  });

  it('GET /api/graph filters relations to project-scoped entities only', async () => {
    const { status, body } = await fetchJson('/api/graph');
    expect(status).toBe(200);

    // The cross-project relation (auth-module → billing-service) should NOT appear,
    // but the explicit project relation remains visible even without its own observation.
    expect(body.relations).toEqual([
      { from: 'auth-module', to: 'token-refresh', relationType: 'related_entity' },
    ]);
  });

  it('GET /api/observations excludes resolved observations', async () => {
    const { status, body } = await fetchJson('/api/observations');
    expect(status).toBe(200);

    const ids = body.map((o: any) => o.id);
    expect(ids).toEqual([1, 2]);
  });

  it('keeps personal observations out of the unbound dashboard and rejects deletion', async () => {
    const { status: observationsStatus, body: observations } = await fetchJson('/api/observations');
    expect(observationsStatus).toBe(200);
    expect(observations.map((observation: any) => observation.id)).not.toContain(7);

    const { status, body } = await fetchJson('/api/observations/7', { method: 'DELETE' });
    expect(status).toBe(403);
    expect(body.error).toContain('not manageable');
  });

  it('does not expose standalone dashboard JSON to arbitrary origins', async () => {
    const response = await fetch(`${DASH_BASE}/api/project`, {
      headers: { Origin: 'https://evil.example' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('GET /api/stats counts only active project observations', async () => {
    const { status, body } = await fetchJson('/api/stats');
    expect(status).toBe(200);

    expect(body.observations).toBe(2);
    expect(body.nextId).toBe(8);
    // Standalone Dashboard cannot inspect an MCP process-local Orama index.
    // It must not claim the project has a fully indexed vector corpus.
    expect(body.vectorStatus).toMatchObject({ available: false, total: 0, missing: 0 });
  });

  it('GET /api/maintenance exposes project-scoped background work state', async () => {
    const { status, body } = await fetchJson('/api/maintenance');

    expect(status).toBe(200);
    expect(body.summary).toMatchObject({ total: 0, pending: 0, running: 0 });
    expect(body.jobs).toEqual([]);
    expect(body.lifecycle).toMatchObject({
      maintenance: { summary: { total: 0 } },
      claims: { total: expect.any(Number) },
      workspaces: expect.any(Array),
      workflows: expect.any(Object),
    });
  });

  it('previews and executes real cleanup only for the selected project', async () => {
    const store = getObservationStore();
    await store.insert({
      id: 8,
      entityName: 'auth-module',
      type: 'discovery',
      title: 'Updated auth.ts',
      narrative: 'Automatic activity noise',
      facts: [],
      filesModified: [],
      concepts: [],
      tokens: 5,
      createdAt: new Date().toISOString(),
      projectId: PROJECT_A,
      status: 'active',
    });
    await store.insert({
      id: 9,
      entityName: 'billing-service',
      type: 'discovery',
      title: 'Updated billing.ts',
      narrative: 'Other project activity noise',
      facts: [],
      filesModified: [],
      concepts: [],
      tokens: 5,
      createdAt: new Date().toISOString(),
      projectId: PROJECT_B,
      status: 'active',
    });

    const preview = await fetchJson('/api/maintenance/cleanup/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ includeNoise: false }),
    });
    expect(preview.status).toBe(200);
    expect(preview.body.projectId).toBe(PROJECT_A);
    expect(preview.body.summary).toMatchObject({ lowQuality: 1, delete: 1, archive: 0 });
    expect(preview.body.lowQuality.map((item: any) => item.id)).toEqual([8]);

    const invalid = await fetchJson('/api/maintenance/cleanup/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: preview.body.payload, token: '0'.repeat(64) }),
    });
    expect(invalid.status).toBe(409);
    expect(await store.getById(8)).toMatchObject({ status: 'active' });

    const execute = await fetchJson('/api/maintenance/cleanup/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: preview.body.payload, token: preview.body.token }),
    });
    expect(execute.status).toBe(200);
    expect(execute.body).toMatchObject({ projectId: PROJECT_A, removed: 1, archived: 0 });
    expect(await store.getById(8)).toBeUndefined();
    expect(await store.getById(9)).toMatchObject({ projectId: PROJECT_B, status: 'active' });
    await store.remove(9);
  });

  it('requires a POST preview for every maintenance action', async () => {
    const { status, body } = await fetchJson('/api/maintenance/consolidate/preview');
    expect(status).toBe(405);
    expect(body.error).toContain('require POST');
  });

  it('GET /api/knowledge returns a project-scoped read-only memory overview', async () => {
    const { status, body } = await fetchJson('/api/knowledge');
    expect(status).toBe(200);

    expect(body.title).toBe('Memory Overview');
    expect(body.subtitle).toBe('Generated from durable project memory');
    expect(body.kind).toBe('memory-overview');
    expect(body.maintained).toBe(false);
    expect(body.projectId).toBe(PROJECT_A);
    expect(body.stats.observationsUsed).toBe(2);

    const titles = body.sections.flatMap((section: any) => section.items.map((item: any) => item.title));
    expect(titles).toContain('Use JWT');
    expect(titles).toContain('Token expiry');
    expect(titles).not.toContain('Use Stripe');
    expect(titles).not.toContain('Webhook retry');
  });

  it('GET /api/knowledge?project=... returns requested project knowledge only', async () => {
    const { status, body } = await fetchJson(`/api/knowledge?project=${encodeURIComponent(PROJECT_B)}`);
    expect(status).toBe(200);

    expect(body.projectId).toBe(PROJECT_B);
    expect(body.stats.observationsUsed).toBe(2);

    const titles = body.sections.flatMap((section: any) => section.items.map((item: any) => item.title));
    expect(titles).toContain('Use Stripe');
    expect(titles).toContain('Webhook retry');
    expect(titles).not.toContain('Use JWT');
    expect(titles).not.toContain('Token expiry');
  });

  // ── /api/knowledge-graph project scope ──

  it('GET /api/knowledge-graph returns a project-scoped deterministic memory map', async () => {
    const { status, body } = await fetchJson('/api/knowledge-graph');
    expect(status).toBe(200);

    expect(body.title).toBe('Memory Map');
    expect(body.kind).toBe('deterministic-memory-map');
    expect(body.semantic).toBe(false);
    expect(body.projectId).toBe(PROJECT_A);
    expect(body.nodes.length).toBeGreaterThan(0);
    expect(body.clusters.length).toBeGreaterThan(0);
    expect(body.stats.totalNodes).toBeGreaterThan(0);

    // No nodes from project B
    const nodeIds = body.nodes.map((n: any) => n.id);
    expect(nodeIds).not.toContain('obs:3');
    expect(nodeIds).not.toContain('obs:4');
  });

  it('GET /api/knowledge-graph?project=... returns requested project graph only', async () => {
    const { status, body } = await fetchJson(`/api/knowledge-graph?project=${encodeURIComponent(PROJECT_B)}`);
    expect(status).toBe(200);

    expect(body.projectId).toBe(PROJECT_B);
    // Project B has billing-service observations
    const labels = body.nodes.map((n: any) => n.label);
    expect(labels).toContain('Use Stripe');
    expect(labels).toContain('Webhook retry');
    expect(labels).not.toContain('Use JWT');
    expect(labels).not.toContain('Token expiry');
  });

  it('GET /api/knowledge-graph excludes resolved observations', async () => {
    const { status, body } = await fetchJson('/api/knowledge-graph');
    expect(status).toBe(200);

    // Project A has obs 1 (active), 2 (active), 5 (resolved)
    // Only 1 and 2 should appear as nodes
    const nodeIds = body.nodes.map((n: any) => n.id);
    expect(nodeIds).toContain('obs:1');
    expect(nodeIds).toContain('obs:2');
    expect(nodeIds).not.toContain('obs:5');
  });

  it('GET /api/knowledge-graph response shape supports showKGInspector', async () => {
    const { status, body } = await fetchJson('/api/knowledge-graph');
    expect(status).toBe(200);

    // Every node must have fields that showKGInspector reads
    for (const node of body.nodes) {
      expect(node).toHaveProperty('id');
      expect(node).toHaveProperty('label');
      expect(node).toHaveProperty('nodeType');
      expect(node).toHaveProperty('sectionId');
      expect(node).toHaveProperty('evidenceCount');
      expect(node).toHaveProperty('summary');
      expect(node).toHaveProperty('refs');
      // sectionId must be a known i18n key target
      expect(['core-decisions', 'operational-knowledge', 'known-gotchas', 'git-backed-facts', 'promoted-skills']).toContain(node.sectionId);
    }

    // Every edge must have fields that the renderer uses
    for (const edge of body.edges) {
      expect(edge).toHaveProperty('id');
      expect(edge).toHaveProperty('source');
      expect(edge).toHaveProperty('target');
      expect(edge).toHaveProperty('edgeType');
      expect(['supports', 'relates_to', 'mentions', 'derived_from']).toContain(edge.edgeType);
    }

    // Clusters must have sectionId for i18n lookup
    for (const cluster of body.clusters) {
      expect(cluster).toHaveProperty('id');
      expect(cluster).toHaveProperty('sectionId');
      expect(cluster).toHaveProperty('nodeCount');
    }
  });

  it('GET /api/projects counts only active observations per project', async () => {
    const { status, body } = await fetchJson('/api/projects');
    expect(status).toBe(200);

    const projectA = body.find((p: any) => p.id === PROJECT_A);
    const projectB = body.find((p: any) => p.id === PROJECT_B);
    expect(projectA?.count).toBe(2);
    expect(projectB?.count).toBe(2);
  });

  it('GET /api/team returns a read-only autonomous agent snapshot in standalone mode', async () => {
    const { status, body } = await fetchJson('/api/team');
    expect(status).toBe(200);

    expect(body.unavailable).not.toBe(true);
    expect(body.mode).toBe('standalone');
    expect(body.readOnly).toBe(true);
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]).toMatchObject({
      name: 'autonomous-codex',
      agentType: 'codex',
      role: 'engineer',
      activityTier: 'active',
    });
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]).toMatchObject({
      description: 'Run autonomous release checks',
      requiredRole: 'engineer',
    });
    expect(body.locks).toHaveLength(1);
    expect(body.locks[0]).toMatchObject({ file: 'src/release.ts' });
    expect(body.availableTasks).toBe(1);
  });

  // ── Bug 2: /export should have project-filtered graph ──

  it('GET /api/export includes only project-scoped graph', async () => {
    const { status, body } = await fetchJson('/api/export');
    expect(status).toBe(200);

    // Observations should be project A only
    expect(body.observations).toHaveLength(2);
    expect(body.observations.every((o: any) => o.projectId === PROJECT_A)).toBe(true);

    // Graph should be project-scoped
    const entityNames = body.graph.entities.map((e: any) => e.name);
    expect(entityNames).toContain('auth-module');
    expect(entityNames).toContain('token-refresh');
    expect(entityNames).not.toContain('billing-service');

    // Cross-project relation is excluded while the explicit project link remains.
    expect(body.graph.relations).toEqual([
      { from: 'auth-module', to: 'token-refresh', relationType: 'related_entity' },
    ]);

    // Metadata
    expect(body.project.id).toBe(PROJECT_A);
  });

  it('GET /api/export?project=... exports the requested project', async () => {
    const { status, body } = await fetchJson(`/api/export?project=${encodeURIComponent(PROJECT_B)}`);
    expect(status).toBe(200);

    expect(body.observations).toHaveLength(2);
    expect(body.observations.every((o: any) => o.projectId === PROJECT_B)).toBe(true);

    const entityNames = body.graph.entities.map((e: any) => e.name);
    expect(entityNames).toContain('billing-service');
    expect(entityNames).not.toContain('auth-module');
  });

  // ── Bug 3: DELETE should validate projectId ──

  it('DELETE /api/observations/:id rejects cross-project deletion with 403', async () => {
    // Try to delete obs #3 (belongs to PROJECT_B) while current project is PROJECT_A
    const { status, body } = await fetchJson('/api/observations/3', { method: 'DELETE' });
    expect(status).toBe(403);
    expect(body.error).toContain(PROJECT_B);
  });

  it('DELETE /api/observations/:id allows same-project deletion', async () => {
    // Delete obs #2 (belongs to PROJECT_A, current project is PROJECT_A)
    const { status, body } = await fetchJson('/api/observations/2', { method: 'DELETE' });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(2);

    // Verify it's actually gone
    const { body: obsBody } = await fetchJson('/api/observations');
    const ids = obsBody.map((o: any) => o.id);
    expect(ids).not.toContain(2);
    // Obs #3 (project B) should still exist in the raw data
  });

  it('DELETE /api/observations/:id returns 404 for non-existent id', async () => {
    const { status } = await fetchJson('/api/observations/999', { method: 'DELETE' });
    expect(status).toBe(404);
  });
});

// ── Embedded serve-http /api/config Tests ──────────────────────────

describe('Embedded serve-http /api/config project scope', () => {
  const HTTP_PORT = 14211;
  const HTTP_BASE = `http://127.0.0.1:${HTTP_PORT}`;
  let httpTempDir: string;
  let httpProjectDir: string;
  const configEnvKeys = [
    'MEMORIX_LLM_PROVIDER', 'MEMORIX_LLM_MODEL', 'MEMORIX_LLM_API_KEY', 'MEMORIX_LLM_BASE_URL',
    'MEMORIX_API_KEY', 'MEMORIX_AGENT_PROVIDER', 'MEMORIX_AGENT_MODEL', 'MEMORIX_AGENT_API_KEY',
    'MEMORIX_AGENT_LLM_API_KEY', 'MEMORIX_EMBEDDING', 'MEMORIX_EMBEDDING_MODEL',
    'MEMORIX_EMBEDDING_API_KEY', 'MEMORIX_EMBEDDING_BASE_URL', 'MEMORIX_RERANK_PROVIDER',
    'MEMORIX_RERANK_MODEL', 'MEMORIX_RERANK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
    'OPENROUTER_API_KEY',
  ];
  const originalConfigEnv = Object.fromEntries(configEnvKeys.map(key => [key, process.env[key]]));

  beforeAll(async () => {
    httpTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-config-test-'));
    httpProjectDir = path.join(httpTempDir, 'my-project');
    await fs.mkdir(httpProjectDir, { recursive: true });

    // Create a fake git repo so detectProject works
    await fs.mkdir(path.join(httpProjectDir, '.git'), { recursive: true });
    await fs.writeFile(
      path.join(httpProjectDir, '.git', 'config'),
      '[remote "origin"]\n\turl = https://github.com/test-org/my-project.git\n',
    );

    await fs.writeFile(path.join(httpProjectDir, 'memorix.toml'), '[memory.llm]\nprovider = "openai"\nmodel = "project-model"\n');
    await fs.writeFile(path.join(httpProjectDir, '.env'), 'OPENAI_API_KEY=project-secret-should-not-load\n');

    await fs.mkdir(path.join(httpTempDir, '.memorix'), { recursive: true });
    await fs.writeFile(path.join(httpTempDir, '.memorix', 'config.toml'), [
      '[memory.llm]',
      'provider = "openai"',
      'model = "user-memory-model"',
      '',
      '[embedding]',
      'provider = "api"',
      'model = "user-embedding-model"',
      '',
      '[rerank]',
      'provider = "http"',
      'model = "user-rerank-model"',
    ].join('\n'));
    await fs.writeFile(path.join(httpTempDir, '.memorix', '.env'), 'OPENAI_API_KEY=user-secret-1234\n');

    // Seed data dir
    const memorixDir = path.join(httpTempDir, '.memorix', 'data');
    await fs.mkdir(memorixDir, { recursive: true });
    await fs.writeFile(path.join(memorixDir, 'observations.json'), '[]');
    await fs.writeFile(path.join(memorixDir, 'counter.json'), '{"nextId": 1}');
    await fs.writeFile(path.join(memorixDir, 'graph.jsonl'), '');
    await fs.writeFile(path.join(memorixDir, 'sessions.json'), '[]');

    process.env.HOME = httpTempDir;
    process.env.USERPROFILE = httpTempDir;
    for (const key of configEnvKeys) delete process.env[key];

    resetDotenv();
    resetConfigCache();
    const { startDashboard } = await import('../../src/dashboard/server.js');
    await startDashboard(
      path.join(httpTempDir, '.memorix', 'data'),
      HTTP_PORT,
      path.join(httpTempDir, 'static'),
      '__unresolved__',
      'unbound',
      false,
      undefined,
      null,
      false,
    );
  }, 15_000);

  afterAll(async () => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    for (const [key, value] of Object.entries(originalConfigEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetDotenv();
    try { await fs.rm(httpTempDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('GET /api/config reports isolated TOML and dotenv provenance', async () => {
    const res = await fetch(`${HTTP_BASE}/api/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const values = new Map(body.values.map((item: any) => [item.key, item]));
    expect(body.files['user config.toml'].exists).toBe(true);
    expect(body.files['project memorix.toml']).toMatchObject({ exists: false, unavailable: true });
    expect(body.files['project .env']).toMatchObject({ exists: false, unavailable: true });
    expect(values.get('llm.provider')).toMatchObject({ value: 'openai', source: 'config.toml' });
    expect(values.get('llm.model')).toMatchObject({ value: 'user-memory-model', source: 'config.toml' });
    expect(values.get('embedding.provider')).toMatchObject({ value: 'api', source: 'config.toml' });
    expect(values.get('embedding.model')).toMatchObject({ value: 'user-embedding-model', source: 'config.toml' });
    expect(values.get('rerank.provider')).toMatchObject({ value: 'http', source: 'config.toml' });
    expect(values.get('rerank.model')).toMatchObject({ value: 'user-rerank-model', source: 'config.toml' });
    expect(values.get('llm.apiKey')).toMatchObject({ value: '****1234', source: '.env' });
    expect(values.get('agent.apiKey')).toMatchObject({ value: 'fallback to llm.apiKey', source: '.env' });
    expect(JSON.stringify(body)).not.toContain('user-secret-1234');
    expect(JSON.stringify(body)).not.toContain('project-secret-should-not-load');
  });

  it('GET /api/config attributes a system override to env:OPENAI_API_KEY', async () => {
    process.env.OPENAI_API_KEY = 'system-secret-5678';
    const res = await fetch(`${HTTP_BASE}/api/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const values = new Map(body.values.map((item: any) => [item.key, item]));
    expect(values.get('llm.apiKey')).toMatchObject({ value: '****5678', source: 'env:OPENAI_API_KEY' });
    expect(values.get('agent.apiKey')).toMatchObject({ source: 'env:OPENAI_API_KEY' });
    expect(JSON.stringify(body)).not.toContain('system-secret-5678');
  });
});
