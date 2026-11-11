import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetConfigCache } from '../../src/config.js';
import { resetDotenv } from '../../src/config/dotenv-loader.js';
import { resetTomlConfigCache } from '../../src/config/toml-loader.js';
import { resetYamlConfigCache } from '../../src/config/yaml-loader.js';
import {
  previewDeduplicate,
  type DashboardMaintenanceContext,
} from '../../src/dashboard/maintenance.js';
import { startDashboard } from '../../src/dashboard/server.js';
import { getLLMConfig, setLLMConfig } from '../../src/llm/provider.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import { getObservationStore, initObservationStore, resetObservationStore } from '../../src/store/obs-store.js';
import type { Observation } from '../../src/types.js';

const DASHBOARD_PORT = 14212;
const PROJECT_ID = 'test/dashboard-deduplicate-llm';

let tempRoot = '';
let projectRoot = '';
let dataDir = '';
let homeDir = '';
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let originalFetch: typeof fetch;

function makeObservation(id: number, title: string): Observation {
  return {
    id,
    entityName: 'auth',
    type: 'discovery',
    title,
    narrative: 'The authentication memory is project scoped and should be deduplicated.',
    facts: ['project scoped'],
    filesModified: [],
    concepts: ['dashboard'],
    tokens: 12,
    createdAt: new Date(2026, 0, id).toISOString(),
    projectId: PROJECT_ID,
    status: 'active',
  };
}

function context(): DashboardMaintenanceContext {
  return {
    dataDir,
    projectId: PROJECT_ID,
    projectRoot,
    store: getObservationStore(),
  };
}

function resetConfigState(): void {
  resetDotenv();
  resetTomlConfigCache();
  resetYamlConfigCache();
  resetConfigCache();
  setLLMConfig(null);
}

describe('dashboard deduplicate memory LLM initialization', () => {
  beforeAll(async () => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalFetch = globalThis.fetch;
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-dashboard-deduplicate-llm-'));
    homeDir = path.join(tempRoot, 'home');
    projectRoot = path.join(tempRoot, 'project');
    dataDir = path.join(tempRoot, 'data');
    await fs.mkdir(path.join(homeDir, '.memorix'), { recursive: true });
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, 'memorix.toml'),
      '[memory.llm]\nprovider = "openai"\nmodel = "dashboard-test-model"\nbase_url = "http://127.0.0.1:14213/v1"\n',
      'utf8',
    );
    await fs.writeFile(path.join(projectRoot, '.env'), 'MEMORIX_LLM_API_KEY=dashboard-project-secret\n', 'utf8');

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    for (const key of [
      'MEMORIX_LLM_API_KEY',
      'MEMORIX_LLM_PROVIDER',
      'MEMORIX_LLM_MODEL',
      'MEMORIX_LLM_BASE_URL',
      'MEMORIX_API_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'OPENROUTER_API_KEY',
    ]) delete process.env[key];
    resetConfigState();

    await initObservationStore(dataDir);
    const store = getObservationStore();
    await store.insert(makeObservation(1, 'Auth memory')); 
    await store.insert(makeObservation(2, 'Auth memory duplicate'));

    globalThis.fetch = vi.fn(async (input, init) => {
      if (!String(input).startsWith('http://127.0.0.1:14213')) {
        return originalFetch(input, init);
      }
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('dashboard-test-model');
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ action: 'NONE', targetId: 1, reason: 'duplicate' }) } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    await startDashboard(dataDir, DASHBOARD_PORT, path.join(tempRoot, 'static'), PROJECT_ID, 'project', false, projectRoot, true);
  }, 15_000);

  beforeEach(() => {
    resetConfigState();
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    resetObservationStore();
    closeAllDatabases();
    resetConfigState();
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('initializes the project memory LLM for the standalone maintenance call', async () => {
    const first = await previewDeduplicate(context());
    const second = await previewDeduplicate(context());

    expect(first.available).toBe(true);
    expect(second.available).toBe(true);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(first)).not.toContain('dashboard-project-secret');
    expect(getLLMConfig()).toMatchObject({ model: 'dashboard-test-model' });
  });

  it('does not leak one project memory LLM into another project', async () => {
    const otherProjectRoot = path.join(tempRoot, 'other-project');
    await fs.mkdir(otherProjectRoot, { recursive: true });

    const result = await previewDeduplicate({
      dataDir,
      projectId: 'test/other-project',
      projectRoot: otherProjectRoot,
      store: getObservationStore(),
    });

    expect(result).toMatchObject({ available: false, action: 'deduplicate' });
    expect(getLLMConfig()).toBeNull();
  });

  it('initializes the same project-scoped LLM through the HTTP dashboard API', async () => {
    const response = await fetch(`http://127.0.0.1:${DASHBOARD_PORT}/api/maintenance/deduplicate/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ available: true, action: 'deduplicate', projectId: PROJECT_ID });
    expect(JSON.stringify(body)).not.toContain('dashboard-project-secret');
    expect(getLLMConfig()).toMatchObject({ model: 'dashboard-test-model' });
  });
});
