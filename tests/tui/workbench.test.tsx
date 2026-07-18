/**
 * TUI Workbench Tests — 4 critical paths for P3 MVP.
 *
 * Covers:
 * - Home tab renders project info, memory stats, navigation hints
 * - Knowledge→Memory ref jump via 'm' key
 * - Workbench session bind UI (explicit Bind/End)
 * - Tab switching via keyboard (Ctrl+Left/Right, slash commands)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { WorkbenchApp } from '../../src/cli/tui/App.js';

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

// Knowledge with first item having refs (so 'm' jump works on index 0)
function makeKnowledge() {
  return {
    title: 'Memory Overview',
    subtitle: 'Generated from durable project memory',
    kind: 'memory-overview',
    maintained: false,
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

// ── Test Suite ──────────────────────────────────────────────────────

describe('WorkbenchApp — tab navigation', () => {
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
    mockChatStore.init.mockResolvedValue(undefined);
    mockChatStore.append.mockImplementation(() => {});
    mockChatStore.load.mockReturnValue([]);
    mockChatStore.clear.mockImplementation(() => {});
    mockChatStore.listThreads.mockReturnValue([]);
    mockChatStore.getLatestThreadId.mockReturnValue(null);
    mockChatStore.newThreadId.mockReturnValue('t-new-thread');
  });

  // ── Critical path 1: Home tab renders project info ──────────────

  it('renders Home tab with project name, memory stats, and tab bar', async () => {
    const { lastFrame, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));
    const frame = lastFrame() ?? '';

    // Active tab indicator
    expect(frame).toContain('# Home');

    // Project info visible
    expect(frame).toContain('my-project');
    expect(frame).toContain('/tmp/project');

    // Memory stats visible (from HealthInfo mock: 38 active, 42 total)
    expect(frame).toContain('38 memories');
    expect(frame).toContain('42 stored');

    // Search mode visible
    expect(frame).toContain('Hybrid');

    // Core tabs rendered in tab bar
    expect(frame).toContain('Home');
    expect(frame).toContain('Knowledge');
    expect(frame).toContain('Memory');
    expect(frame).toContain('Workbench');

    // Navigation hints
    expect(frame).toContain('Alt+2 Knowledge');
    expect(frame).toContain('Alt+3 Memory');
    expect(frame).toContain('Alt+4 Workbench');

    unmount();
  });

  it('shows getting-started guidance when no project detected', async () => {
    mockGetProjectInfo.mockResolvedValue(null);
    mockGetHealthInfo.mockResolvedValue({
      embeddingProvider: 'disabled',
      embeddingLabel: 'Disabled',
      searchMode: 'fulltext',
      searchModeLabel: 'BM25 full-text',
      searchDiagnostic: '',
      backfillPending: 0,
      totalMemories: 0,
      activeMemories: 0,
      sessions: 0,
    });

    const { lastFrame, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));
    const frame = lastFrame() ?? '';

    expect(frame).toContain('No project detected');
    expect(frame).toContain('Getting Started');
    expect(frame).toContain('git init');

    unmount();
  });

  // ── Critical path 2: Knowledge→Memory ref jump via 'm' key ─────

  it('loads knowledge via /wiki and renders items with refs', async () => {
    mockGetKnowledgeBase.mockResolvedValue(makeKnowledge());

    const { lastFrame, stdin, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));

    // Submit /wiki command with trailing space to bypass palette auto-complete
    stdin.write('/wiki ');
    await waitForCondition(() => (lastFrame() ?? '').includes('[cmd] > /wiki '));
    stdin.write('\r');

    // Wait for knowledge tab to render
    await waitForCondition(() => {
      const f = lastFrame() ?? '';
      return f.includes('# Knowledge') && f.includes('Memory Overview');
    });

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Use JWT for auth');
    expect(frame).toContain('obs:1');
    expect(frame).toContain('Core Decisions');
    // Footer shows navigation help
    expect(frame).toContain('m > Memory');

    unmount();
  }, 10000);

  it('jumps from Knowledge to Memory via m key', async () => {
    mockGetKnowledgeBase.mockResolvedValue(makeKnowledge());

    const { lastFrame, stdin, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));

    // Navigate to Knowledge tab
    stdin.write('/wiki ');
    await waitForCondition(() => (lastFrame() ?? '').includes('[cmd] > /wiki '));
    stdin.write('\r');
    await waitForCondition(() => {
      const f = lastFrame() ?? '';
      return f.includes('# Knowledge') && f.includes('Use JWT for auth');
    });

    // Wait for command bar to fully clear (inputFocused → false)
    await tick(300);

    // Press 'm' — the first knowledge item (index 0) has refs, so the jump fires
    stdin.write('m');

    // Wait for Memory tab
    await waitForCondition(() => {
      const f = lastFrame() ?? '';
      return f.includes('# Memory');
    });

    const frame = lastFrame() ?? '';
    expect(frame).toContain('# Memory');
    expect(frame).not.toContain('# Knowledge');

    unmount();
  }, 10000);

  // ── Critical path 3: Workbench session bind UI ──────────────────

  it('shows Session and Bind action on Workbench tab', async () => {
    const { lastFrame, stdin, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));

    // Navigate to Workbench via keyboard shortcut (Ctrl+Right three times from Home)
    stdin.write('\x1B[1;5C'); // Home → Knowledge
    await tick(100);
    stdin.write('\x1B[1;5C'); // Knowledge → Memory
    await tick(100);
    stdin.write('\x1B[1;5C'); // Memory → Workbench

    // Wait for workbench tab to render
    await waitForCondition(() => (lastFrame() ?? '').includes('# Workbench'));
    const frame = lastFrame() ?? '';

    // Session section visible
    expect(frame).toContain('Session');

    // Context sources visible
    expect(frame).toContain('Context Sources');

    // Chat area visible
    expect(frame).toContain('Chat');

    // Bind action button visible (for unbound status)
    expect(frame).toContain('[Bind Session]');

    unmount();
  }, 10000);

  it('shows End Session UI when session is already bound', async () => {
    mockGetSessionState.mockResolvedValue({
      status: 'bound',
      sessionId: 'sess-active-1',
      startedAt: new Date().toISOString(),
      agent: 'claude-code',
    });

    const { lastFrame, stdin, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));

    stdin.write('/workbench');
    await waitForCondition(() => (lastFrame() ?? '').includes('[cmd] > /workbench'));
    stdin.write('\r');

    await waitForCondition(() => (lastFrame() ?? '').includes('[End Session]'));
    const frame = lastFrame() ?? '';

    expect(frame).toContain('[End Session]');
    expect(frame).toContain('enter to end');

    unmount();
  }, 10000);

  // ── Critical path 4: Tab switching via keyboard ─────────────────

  it('switches tabs via Ctrl+Left and Ctrl+Right', async () => {
    const { lastFrame, stdin, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));
    expect(lastFrame() ?? '').toContain('# Home');

    // Ctrl+Right → Knowledge
    stdin.write('\x1B[1;5C');
    await waitForCondition(() => (lastFrame() ?? '').includes('# Knowledge'));
    expect(lastFrame() ?? '').toContain('Memory Overview');

    // Ctrl+Right → Memory
    stdin.write('\x1B[1;5C');
    await waitForCondition(() => (lastFrame() ?? '').includes('# Memory'));

    // Ctrl+Right → Workbench
    stdin.write('\x1B[1;5C');
    await waitForCondition(() => (lastFrame() ?? '').includes('# Workbench'));

    // Ctrl+Left → Memory
    stdin.write('\x1B[1;5D');
    await waitForCondition(() => (lastFrame() ?? '').includes('# Memory'));

    // Ctrl+Left → Knowledge
    stdin.write('\x1B[1;5D');
    await waitForCondition(() => (lastFrame() ?? '').includes('# Knowledge'));

    // Ctrl+Left → Home
    stdin.write('\x1B[1;5D');
    await waitForCondition(() => (lastFrame() ?? '').includes('# Home'));

    unmount();
  }, 10000);

  it('switches to Memory tab via /memory command', async () => {
    const { lastFrame, stdin, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));

    // /memory is now arg-less in CommandBar
    stdin.write('/memory');
    await waitForCondition(() => (lastFrame() ?? '').includes('[cmd] > /memory'));
    stdin.write('\r');

    await waitForCondition(() => (lastFrame() ?? '').includes('# Memory'));
    expect(lastFrame() ?? '').toContain('Recent Memory');

    unmount();
  }, 10000);

  // ── Input focus conflict prevention ──────────────────────────────

  it('Workbench tab: CommandBar Enter does not trigger session bind when typing', async () => {
    const { lastFrame, stdin, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));

    // Navigate to Workbench
    stdin.write('\x1B[1;5C'); // Home → Knowledge
    await tick(100);
    stdin.write('\x1B[1;5C'); // Knowledge → Memory
    await tick(100);
    stdin.write('\x1B[1;5C'); // Memory → Workbench
    await waitForCondition(() => (lastFrame() ?? '').includes('# Workbench'));

    // Type in CommandBar — this sets inputFocused=true
    stdin.write('/rando');
    await waitForCondition(() => (lastFrame() ?? '').includes('[cmd] > /rando'));

    // Press Enter while input is focused → should NOT trigger bind
    stdin.write('\r');

    // Let any async effects settle
    await tick(300);

    const frame = lastFrame() ?? '';
    // bindSession should NOT have been called
    expect(mockBindSession).not.toHaveBeenCalled();
    // Should still show Bind action (not bound)
    expect(frame).toContain('[Bind Session]');

    unmount();
  }, 10000);

  it('Memory tab: CommandBar typing k does not trigger Knowledge jump', async () => {
    mockGetKnowledgeBase.mockResolvedValue(makeKnowledge());

    const { lastFrame, stdin, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));

    // Navigate to Memory tab
    stdin.write('\x1B[1;5C'); // Home → Knowledge
    await tick(100);
    stdin.write('\x1B[1;5C'); // Knowledge → Memory
    await waitForCondition(() => (lastFrame() ?? '').includes('# Memory'));

    // Type 'k' in CommandBar — this sets inputFocused=true
    stdin.write('/');
    await tick(80);
    stdin.write('k');

    // Wait for CommandBar to show the typed input
    await waitForCondition(() => (lastFrame() ?? '').includes('[cmd] > /k'));

    // Let any async effects settle
    await tick(300);

    // Should still be on Memory tab (not jumped to Knowledge)
    const frame = lastFrame() ?? '';
    expect(frame).toContain('# Memory');
    expect(frame).not.toContain('# Knowledge');

    unmount();
  }, 10000);

  it('returns to Home tab via /home command', async () => {
    const { lastFrame, stdin, unmount } = render(
      <WorkbenchApp version="1.0.9" onExitForInteractive={() => {}} />,
    );

    await waitForCondition(() => (lastFrame() ?? '').includes('New chat ready'));

    // Navigate away first
    stdin.write('/memory');
    await waitForCondition(() => (lastFrame() ?? '').includes('[cmd] > /memory'));
    stdin.write('\r');
    await waitForCondition(() => (lastFrame() ?? '').includes('# Memory'));

    // Then back to home
    stdin.write('/home');
    await waitForCondition(() => (lastFrame() ?? '').includes('[cmd] > /home'));
    stdin.write('\r');
    await waitForCondition(() => (lastFrame() ?? '').includes('# Home'));
    expect(lastFrame() ?? '').toContain('my-project');

    unmount();
  }, 10000);
});
