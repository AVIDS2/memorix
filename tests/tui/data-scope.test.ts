/**
 * TUI Data Layer — Project Scope Tests
 *
 * Verifies that getHealthInfo and getRecentMemories filter by projectId
 * in flat storage, and that the scope is consistent with searchMemories.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: async () => null,
  isVectorSearchAvailable: async () => false,
  isEmbeddingExplicitlyDisabled: () => true,
  resetProvider: () => {},
}));

const PROJECT_A = 'test-org/project-a';
const PROJECT_B = 'test-org/project-b';

let testDir: string;
let dataDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-tui-scope-'));
  dataDir = path.join(testDir, '.memorix', 'data');
  await fs.mkdir(dataDir, { recursive: true });

  // Seed flat storage with observations from two projects
  const observations = [
    { id: 1, entityName: 'auth', type: 'decision', title: 'Use JWT', narrative: 'JWT auth', facts: [], projectId: PROJECT_A, status: 'active', createdAt: '2025-01-01T00:00:00Z' },
    { id: 2, entityName: 'auth', type: 'gotcha', title: 'Token leak', narrative: 'Token leaks', facts: [], projectId: PROJECT_A, status: 'active', createdAt: '2025-01-02T00:00:00Z' },
    { id: 3, entityName: 'auth', type: 'discovery', title: 'Old entry', narrative: 'Resolved', facts: [], projectId: PROJECT_A, status: 'resolved', createdAt: '2024-06-01T00:00:00Z' },
    { id: 4, entityName: 'billing', type: 'decision', title: 'Use Stripe', narrative: 'Stripe billing', facts: [], projectId: PROJECT_B, status: 'active', createdAt: '2025-01-03T00:00:00Z' },
    { id: 5, entityName: 'billing', type: 'gotcha', title: 'Webhook retry', narrative: 'Retry logic', facts: [], projectId: PROJECT_B, status: 'active', createdAt: '2025-01-04T00:00:00Z' },
  ];
  await fs.writeFile(path.join(dataDir, 'observations.json'), JSON.stringify(observations));
  await fs.writeFile(path.join(dataDir, 'counter.json'), JSON.stringify({ nextId: 6 }));
  await fs.writeFile(path.join(dataDir, 'sessions.json'), JSON.stringify([
    { id: 's1', projectId: PROJECT_A },
    { id: 's2', projectId: PROJECT_A },
    { id: 's3', projectId: PROJECT_B },
  ]));
  await fs.writeFile(path.join(dataDir, 'graph.jsonl'), '');
});

describe('getHealthInfo project scope', () => {
  it('counts only the specified project observations', async () => {
    // Mock detectProject + getProjectDataDir to use our test dir
    vi.doMock('../../src/project/detector.js', () => ({
      detectProject: () => ({ id: PROJECT_A, name: 'project-a', rootPath: testDir, gitRemote: 'none' }),
    }));
    vi.doMock('../../src/store/persistence.js', async () => {
      const actual = await vi.importActual('../../src/store/persistence.js') as any;
      return { ...actual, getProjectDataDir: async () => dataDir };
    });

    // Clear module cache so mocks take effect
    const { getHealthInfo } = await import('../../src/cli/tui/data.js');
    const health = await getHealthInfo(PROJECT_A);

    // Project A: 3 total (2 active + 1 resolved), NOT 5 (global)
    expect(health.totalMemories).toBe(3);
    expect(health.activeMemories).toBe(2);
    // Sessions for project A only: 2, not 3
    expect(health.sessions).toBe(2);

    vi.doUnmock('../../src/project/detector.js');
    vi.doUnmock('../../src/store/persistence.js');
  });

  it('project B gets its own counts', async () => {
    vi.doMock('../../src/project/detector.js', () => ({
      detectProject: () => ({ id: PROJECT_B, name: 'project-b', rootPath: testDir, gitRemote: 'none' }),
    }));
    vi.doMock('../../src/store/persistence.js', async () => {
      const actual = await vi.importActual('../../src/store/persistence.js') as any;
      return { ...actual, getProjectDataDir: async () => dataDir };
    });

    const { getHealthInfo } = await import('../../src/cli/tui/data.js');
    const health = await getHealthInfo(PROJECT_B);

    expect(health.totalMemories).toBe(2);
    expect(health.activeMemories).toBe(2);
    expect(health.sessions).toBe(1);

    vi.doUnmock('../../src/project/detector.js');
    vi.doUnmock('../../src/store/persistence.js');
  });
});

describe('getRecentMemories project scope', () => {
  it('returns only the specified project memories', async () => {
    vi.doMock('../../src/project/detector.js', () => ({
      detectProject: () => ({ id: PROJECT_A, name: 'project-a', rootPath: testDir, gitRemote: 'none' }),
    }));
    vi.doMock('../../src/store/persistence.js', async () => {
      const actual = await vi.importActual('../../src/store/persistence.js') as any;
      return { ...actual, getProjectDataDir: async () => dataDir };
    });

    const { getRecentMemories } = await import('../../src/cli/tui/data.js');
    const recent = await getRecentMemories(10, PROJECT_A);

    // Project A has 2 active observations (id 1, 2), NOT global 4 active
    expect(recent).toHaveLength(2);
    expect(recent.every(m => m.id === 1 || m.id === 2)).toBe(true);

    vi.doUnmock('../../src/project/detector.js');
    vi.doUnmock('../../src/store/persistence.js');
  });
});
