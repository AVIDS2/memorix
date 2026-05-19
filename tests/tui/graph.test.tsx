/**
 * TUI Graph Tab Tests — P3.1 graph text browser.
 *
 * Covers:
 * - Graph tab renders with summary stats
 * - Cluster and node list visible
 * - Node detail panel expansion
 * - Graph -> Knowledge jump via k key
 * - Filter cycling (f key)
 * - Navigation via /graph command and Alt+5
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { WorkbenchApp } from '../../src/cli/tui/App.js';
import type { ProjectKnowledgeGraph } from '../../src/wiki/types.js';

const {
  mockGetProjectInfo,
  mockGetHealthInfo,
  mockGetRecentMemories,
  mockGetBackgroundStatus,
  mockSearchMemories,
  mockStoreQuickMemory,
  mockGetDoctorSummary,
  mockGetKnowledgeBase,
  mockGetSessionState,
  mockBindSession,
  mockUnbindSession,
  mockDetectMode,
  mockGetProjectDataDir,
  mockGetKnowledgeGraph,
  mockChatStore,
} = vi.hoisted(() => ({
  mockGetProjectInfo: vi.fn(),
  mockGetHealthInfo: vi.fn(),
  mockGetRecentMemories: vi.fn(),
  mockGetBackgroundStatus: vi.fn(),
  mockSearchMemories: vi.fn(),
  mockStoreQuickMemory: vi.fn(),
  mockGetDoctorSummary: vi.fn(),
  mockGetKnowledgeBase: vi.fn(),
  mockGetSessionState: vi.fn(),
  mockBindSession: vi.fn(),
  mockUnbindSession: vi.fn(),
  mockDetectMode: vi.fn(),
  mockGetProjectDataDir: vi.fn(),
  mockGetKnowledgeGraph: vi.fn(),
  mockChatStore: {
    init: vi.fn(),
    append: vi.fn(),
    load: vi.fn(),
    clear: vi.fn(),
    listThreads: vi.fn(),
    getLatestThreadId: vi.fn(),
    newThreadId: vi.fn(),
  },
}));

vi.mock('../../src/cli/tui/data.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/cli/tui/data.js')>('../../src/cli/tui/data.js');
  return {
    ...actual,
    getProjectInfo: mockGetProjectInfo,
    getHealthInfo: mockGetHealthInfo,
    getRecentMemories: mockGetRecentMemories,
    getBackgroundStatus: mockGetBackgroundStatus,
    searchMemories: mockSearchMemories,
    storeQuickMemory: mockStoreQuickMemory,
    getDoctorSummary: mockGetDoctorSummary,
    getKnowledgeBase: mockGetKnowledgeBase,
    getKnowledgeGraph: mockGetKnowledgeGraph,
    getSessionState: mockGetSessionState,
    bindSession: mockBindSession,
    unbindSession: mockUnbindSession,
    detectMode: mockDetectMode,
  };
});

vi.mock('../../src/cli/tui/chat-service.js', () => ({
  askMemoryQuestion: vi.fn(),
  askMemoryQuestionStream: vi.fn(),
}));

vi.mock('../../src/store/persistence.js', () => ({
  getProjectDataDir: mockGetProjectDataDir,
}));

vi.mock('../../src/store/chat-store.js', () => ({
  getChatStore: () => mockChatStore,
}));

const tick = (ms = 120) => new Promise<void>(r => setTimeout(r, ms));

async function waitForCondition(
  predicate: () => boolean,
  attempts = 50,
  ms = 100,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return;
    await tick(ms);
  }
}

function makeHealth(overrides?: Partial<import('../../src/cli/tui/data.js').HealthInfo>) {
  return {
    embeddingProvider: 'ready' as const,
    embeddingProviderName: 'openai',
    embeddingLabel: 'Ready',
    searchMode: 'hybrid' as const,
    searchModeLabel: 'Hybrid',
    searchDiagnostic: '',
    backfillPending: 0,
    totalMemories: 42,
    activeMemories: 38,
    sessions: 5,
    ...overrides,
  };
}

function makeProject() {
  return { id: 'test/proj', name: 'my-project', rootPath: '/tmp/project', gitRemote: 'origin' };
}

// Knowledge with refs for graph->knowledge jump verification
function makeKnowledge() {
  return {
    title: 'Knowledge Base',
    subtitle: 'LLM Wiki',
    projectId: 'test/proj',
    generatedAt: new Date().toISOString(),
    sections: [
      {
        id: 'core-decisions',
        title: 'Core Decisions',
        items: [{
          title: 'Use JWT for auth',
          summary: 'We chose JWT because it is stateless.',
          type: 'decision' as const,
          entityName: 'auth',
          refs: [{ kind: 'observation' as const, id: 'obs:1', title: 'Use JWT for auth' }],
        }],
      },
      {
        id: 'project-overview',
        title: 'Project Overview',
        items: [{ title: 'test/proj', summary: 'Project: test/proj', type: 'overview' as const, refs: [] }],
      },
    ],
    stats: { observationsUsed: 1, miniSkillsUsed: 0, refs: 1 },
  };
}

function makeGraph(): ProjectKnowledgeGraph {
  return {
    title: 'Knowledge Graph',
    projectId: 'test/proj',
    generatedAt: new Date().toISOString(),
    nodes: [
      {
        id: 'obs:1',
        label: 'Use JWT for auth',
        nodeType: 'decision',
        sectionId: 'core-decisions',
        entityName: 'auth',
        evidenceCount: 3,
        summary: 'We chose JWT because it is stateless and works well with our microservices.',
        refs: [{ kind: 'observation', id: 'obs:1', title: 'Use JWT for auth' }],
      },
      {
        id: 'obs:2',
        label: 'Store refresh tokens in Redis',
        nodeType: 'how-it-works',
        sectionId: 'operational-knowledge',
        entityName: 'auth',
        evidenceCount: 2,
        summary: 'Refresh tokens are stored in Redis with TTL matching token expiry.',
        refs: [{ kind: 'observation', id: 'obs:2', title: 'Store refresh tokens in Redis' }],
      },
      {
        id: 'obs:3',
        label: 'Docker port collision on 5432',
        nodeType: 'gotcha',
        sectionId: 'known-gotchas',
        entityName: 'docker',
        evidenceCount: 1,
        summary: 'Local Postgres collides with container port. Use 5433 for containers.',
        refs: [{ kind: 'observation', id: 'obs:3', title: 'Docker port collision on 5432' }],
      },
    ],
    edges: [
      { id: 'e_0', source: 'obs:1', target: 'obs:2', edgeType: 'supports' },
      { id: 'e_1', source: 'obs:2', target: 'obs:1', edgeType: 'relates_to' },
    ],
    clusters: [
      { id: 'cluster:core-decisions', label: 'Core Decisions', sectionId: 'core-decisions', nodeCount: 1 },
      { id: 'cluster:operational-knowledge', label: 'Operational Knowledge', sectionId: 'operational-knowledge', nodeCount: 1 },
      { id: 'cluster:known-gotchas', label: 'Known Gotchas', sectionId: 'known-gotchas', nodeCount: 1 },
    ],
    stats: {
      totalNodes: 3,
      totalEdges: 2,
      clusterCount: 3,
      sectionCounts: { 'core-decisions': 1, 'operational-knowledge': 1, 'known-gotchas': 1 },
    },
  };
}

// ── Test Suite ──────────────────────────────────────────────────────

describe('WorkbenchApp — Graph tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProjectInfo.mockResolvedValue(makeProject());
    mockGetHealthInfo.mockResolvedValue(makeHealth());
    mockGetRecentMemories.mockResolvedValue([]);
    mockGetBackgroundStatus.mockResolvedValue({ running: false, healthy: false });
    mockSearchMemories.mockResolvedValue([]);
    mockStoreQuickMemory.mockResolvedValue(null);
    mockGetDoctorSummary.mockResolvedValue(null);
    mockGetKnowledgeBase.mockResolvedValue(null);
    mockGetSessionState.mockResolvedValue({ status: 'unbound' });
    mockBindSession.mockResolvedValue({ status: 'bound', sessionId: 'sess-test-1', startedAt: new Date().toISOString() });
    mockUnbindSession.mockResolvedValue({ status: 'unbound' });
    mockDetectMode.mockReturnValue({ mode: 'CLI', detail: 'Quick mode' });
    mockGetProjectDataDir.mockResolvedValue('/tmp/memorix');
    mockGetKnowledgeGraph.mockResolvedValue(null);
    mockChatStore.init.mockResolvedValue(undefined);
    mockChatStore.append.mockImplementation(() => {});
    mockChatStore.load.mockReturnValue([]);
    mockChatStore.clear.mockImplementation(() => {});
    mockChatStore.listThreads.mockReturnValue([]);
    mockChatStore.getLatestThreadId.mockReturnValue(null);
    mockChatStore.newThreadId.mockReturnValue('t-new-thread');
  });

  // ── Graph summary rendering ──────────────────────────────────────

  it('renders Graph tab with summary stats', async () => {
    mockGetKnowledgeGraph.mockResolvedValue(makeGraph());

    const { lastFrame, stdin, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));

    // Navigate to Graph via Alt+5
    stdin.write('\x1B5'); // Alt+5
    await waitForCondition(() => (lastFrame() ?? '').includes('Knowledge Graph'));

    const frame = lastFrame() ?? '';
    expect(frame).toContain('# Graph'); // Active tab indicator
    expect(frame).toContain('Knowledge Graph');
    expect(frame).toContain('3 nodes');
    expect(frame).toContain('2 edges');
    expect(frame).toContain('3 clusters');

    unmount();
  }, 10000);

  // ── Cluster and node list ────────────────────────────────────────

  it('shows clusters and nodes in the graph', async () => {
    mockGetKnowledgeGraph.mockResolvedValue(makeGraph());

    const { lastFrame, stdin, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));

    stdin.write('\x1B5'); // Alt+5
    await waitForCondition(() => (lastFrame() ?? '').includes('Knowledge Graph'));

    const frame = lastFrame() ?? '';
    // Clusters visible
    expect(frame).toContain('Core Decisions');
    expect(frame).toContain('Operational Knowledge');
    expect(frame).toContain('Known Gotchas');
    // Nodes visible
    expect(frame).toContain('Use JWT for auth');
    expect(frame).toContain('Store refresh tokens in Redis');
    expect(frame).toContain('Docker port collision');
    // Filter bar
    expect(frame).toContain('[All]');
    expect(frame).toContain('f filter');

    unmount();
  }, 10000);

  // ── Node detail expansion ────────────────────────────────────────

  it('expands node detail on Enter', async () => {
    mockGetKnowledgeGraph.mockResolvedValue(makeGraph());

    const { lastFrame, stdin, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));

    stdin.write('\x1B5'); // Alt+5
    await waitForCondition(() => (lastFrame() ?? '').includes('Knowledge Graph'));

    // Move selection down to first node (index 0 = cluster header, index 1 = "Use JWT for auth")
    await tick(200);
    stdin.write('\x1B[B');
    await tick(200);

    // Enter on selected node → expand detail
    stdin.write('\r');

    // Detail should show node content (heading may not appear in capture, check for detail data)
    await waitForCondition(() => (lastFrame() ?? '').includes('evidence: 3'));

    const frame = lastFrame() ?? '';
    // Detail content visible in frame
    expect(frame).toContain('Use JWT for auth');
    expect(frame).toContain('cluster: Core Decisions');
    expect(frame).toContain('evidence: 3');
    expect(frame).toContain('We chose JWT');
    // Edge summary
    expect(frame).toContain('Outgoing');
    expect(frame).toContain('Incoming');
    // Navigation hints
    expect(frame).toContain('esc back');
    expect(frame).toContain('k > Knowledge');

    unmount();
  }, 10000);

  // ── Graph → Knowledge jump ───────────────────────────────────────

  it('jumps from Graph node to Knowledge via k key', async () => {
    mockGetKnowledgeGraph.mockResolvedValue(makeGraph());
    mockGetKnowledgeBase.mockResolvedValue(makeKnowledge());

    const { lastFrame, stdin, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));

    // Navigate to Graph
    stdin.write('\x1B5'); // Alt+5
    await waitForCondition(() => (lastFrame() ?? '').includes('Knowledge Graph'));

    // Move to first node (down 1 to skip cluster header)
    await tick(200);
    stdin.write('\x1B[B');
    await tick(200);

    // Press k for Knowledge jump (inputFocused is false since CommandBar is empty)
    stdin.write('k');

    // Should jump to Knowledge tab
    await waitForCondition(() => (lastFrame() ?? '').includes('# Knowledge'));

    const frame = lastFrame() ?? '';
    expect(frame).toContain('# Knowledge');
    expect(frame).not.toContain('# Graph');

    unmount();
  }, 10000);

  // ── Filter cycling ───────────────────────────────────────────────

  it('cycles filter from All to cluster via f key', async () => {
    mockGetKnowledgeGraph.mockResolvedValue(makeGraph());

    const { lastFrame, stdin, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));

    stdin.write('\x1B5'); // Alt+5
    await waitForCondition(() => (lastFrame() ?? '').includes('Knowledge Graph'));
    await tick(200);

    // Initially: All
    expect(lastFrame() ?? '').toContain('[All]');

    // f: cycle filter to cluster mode — must NOT leak into command bar
    stdin.write('f');
    await waitForCondition(() => (lastFrame() ?? '').includes('Cluster:'));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Cluster:');
    expect(frame).toContain('left/right switch');
    // Should show only nodes from the filtered cluster
    expect(frame).toContain('Core Decisions');
    // Verify f did NOT seed into the command bar input
    expect(frame).not.toContain('[cmd] > f');

    unmount();
  }, 10000);

  // ── Normal typing from empty command bar ───────────────────────

  it('accepts normal characters from empty command bar on Graph tab', async () => {
    mockGetKnowledgeGraph.mockResolvedValue(makeGraph());

    const { lastFrame, stdin, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));

    stdin.write('\x1B5'); // Alt+5 → Graph tab
    await waitForCondition(() => (lastFrame() ?? '').includes('Knowledge Graph'));
    await tick(200);

    // Type a non-blocked character from empty command bar
    stdin.write('a');
    await tick(300);

    const frame = lastFrame() ?? '';
    // The character should appear in the command bar
    expect(frame).toContain('[cmd] > a');
    // Shortcut chars should NOT be blocked (only f/k are on Graph)
    // so normal typing works fine

    unmount();
  }, 10000);

  // ── Navigate via /graph command ──────────────────────────────────

  it('navigates to Graph tab via /graph command', async () => {
    mockGetKnowledgeGraph.mockResolvedValue(makeGraph());

    const { lastFrame, stdin, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));

    stdin.write('/graph');
    await waitForCondition(() => (lastFrame() ?? '').includes('[cmd] > /graph'));
    stdin.write('\r');

    await waitForCondition(() => (lastFrame() ?? '').includes('# Graph'));
    expect(lastFrame() ?? '').toContain('Knowledge Graph');

    unmount();
  }, 10000);

  // ── Graph tab in tab bar ─────────────────────────────────────────

  it('shows Graph as 5th tab in tab bar', async () => {
    mockGetKnowledgeGraph.mockResolvedValue(makeGraph());

    const { lastFrame, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));
    await tick(200);

    const frame = lastFrame() ?? '';
    // All 5 tabs rendered
    expect(frame).toContain('Home');
    expect(frame).toContain('Knowledge');
    expect(frame).toContain('Memory');
    expect(frame).toContain('Workbench');
    expect(frame).toContain('Graph');

    unmount();
  });

  // ── Empty graph state ────────────────────────────────────────────

  it('shows empty state when no graph data available', async () => {
    mockGetKnowledgeGraph.mockResolvedValue(null);

    const { lastFrame, stdin, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));

    stdin.write('\x1B5'); // Alt+5
    await waitForCondition(() => (lastFrame() ?? '').includes('Knowledge Graph'));

    const frame = lastFrame() ?? '';
    expect(frame).toContain('No graph data available');

    unmount();
  }, 10000);
});
