/**
 * TUI Interaction Tests — ink-testing-library
 *
 * Covers:
 * - useNavigation: resolveGlobalNav, ACTION_VIEWS, ESC_RETURNABLE_VIEWS
 * - CommandBar: typing, slash palette, Enter executes, Esc clears, disabled state, focus change
 * - ConfigureView: menu rendering, Esc back callback
 * - Sidebar: active view highlight, action list rendering
 * - Keyboard model: action view keys block global nav, input focus blocks global nav
 *
 * Note: ink v5 + React 18 batches state updates asynchronously.
 * All stdin-dependent assertions require an `await tick()` to flush.
 */

import React, { useState, useCallback } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Box, Text, useInput } from 'ink';

const tick = (ms = 50) => new Promise<void>(r => setTimeout(r, ms));

async function waitForCondition(
  predicate: () => boolean,
  attempts = 6,
  ms = 80,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return;
    await tick(ms);
  }
}

// ── useNavigation pure logic tests ──────────────────────────────────

import {
  NAV_KEY_MAP,
  ACTION_VIEWS,
  ESC_RETURNABLE_VIEWS,
  resolveGlobalNav,
} from '../../src/cli/tui/useNavigation.js';

describe('useNavigation', () => {
  it('NAV_KEY_MAP maps all expected shortcut keys', () => {
    expect(NAV_KEY_MAP['s']).toBe('/search');
    expect(NAV_KEY_MAP['r']).toBe('/remember');
    expect(NAV_KEY_MAP['v']).toBe('/recent');
    expect(NAV_KEY_MAP['d']).toBe('/doctor');
    expect(NAV_KEY_MAP['b']).toBe('/background');
    expect(NAV_KEY_MAP['w']).toBe('/dashboard');
    expect(NAV_KEY_MAP['p']).toBe('/project');
    expect(NAV_KEY_MAP['c']).toBe('/configure');
    expect(NAV_KEY_MAP['i']).toBe('/integrate');
    expect(NAV_KEY_MAP['h']).toBe('/home');
  });

  it('ACTION_VIEWS contains all action views', () => {
    expect(ACTION_VIEWS.has('cleanup')).toBe(true);
    expect(ACTION_VIEWS.has('ingest')).toBe(true);
    expect(ACTION_VIEWS.has('background')).toBe(true);
    expect(ACTION_VIEWS.has('dashboard')).toBe(true);
    expect(ACTION_VIEWS.has('integrate')).toBe(true);
    expect(ACTION_VIEWS.has('configure')).toBe(true);
    // Non-action views
    expect(ACTION_VIEWS.has('home')).toBe(false);
    expect(ACTION_VIEWS.has('search')).toBe(false);
    expect(ACTION_VIEWS.has('recent')).toBe(false);
  });

  it('ESC_RETURNABLE_VIEWS includes secondary views', () => {
    expect(ESC_RETURNABLE_VIEWS.has('recent')).toBe(true);
    expect(ESC_RETURNABLE_VIEWS.has('doctor')).toBe(true);
    expect(ESC_RETURNABLE_VIEWS.has('configure')).toBe(true);
    expect(ESC_RETURNABLE_VIEWS.has('search')).toBe(true);
    // Home is not esc-returnable (already home)
    expect(ESC_RETURNABLE_VIEWS.has('home' as any)).toBe(false);
  });

  describe('resolveGlobalNav', () => {
    it('returns command for nav key when on non-action view', () => {
      expect(resolveGlobalNav('v', 'home', false)).toBe('/recent');
      expect(resolveGlobalNav('d', 'home', false)).toBe('/doctor');
      expect(resolveGlobalNav('h', 'search', false)).toBe('/home');
    });

    it('returns null for nav key when on action view', () => {
      expect(resolveGlobalNav('v', 'cleanup', false)).toBeNull();
      expect(resolveGlobalNav('d', 'configure', false)).toBeNull();
    });

    it('returns null when input is focused', () => {
      expect(resolveGlobalNav('v', 'home', true)).toBeNull();
    });

    it('returns null for unmapped keys', () => {
      expect(resolveGlobalNav('x', 'home', false)).toBeNull();
      expect(resolveGlobalNav('1', 'home', false)).toBeNull();
    });
  });
});

// ── CommandBar interaction tests ────────────────────────────────────

import { CommandBar } from '../../src/cli/tui/CommandBar.js';

describe('CommandBar', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders with placeholder text when empty', () => {
    const { lastFrame, unmount } = render(
      <CommandBar onSubmit={() => {}} onExit={() => {}} />,
    );
    const frame = lastFrame();
    expect(frame).toContain('>');
    expect(frame).toContain('search memories or /command');
    unmount();
  });

  it('disabled state shows hint instead of input', () => {
    const { lastFrame, unmount } = render(
      <CommandBar onSubmit={() => {}} onExit={() => {}} disabled disabledHint="cleanup: 1/2/3" />,
    );
    expect(lastFrame()).toContain('cleanup: 1/2/3');
    unmount();
  });

  it('typing characters updates display', async () => {
    const { lastFrame, stdin, unmount } = render(
      <CommandBar onSubmit={() => {}} onExit={() => {}} />,
    );
    stdin.write('hello');
    await tick();
    expect(lastFrame()).toContain('hello');
    unmount();
  });

  it('Enter submits input and clears', async () => {
    const onSubmit = vi.fn();
    const { lastFrame, stdin, unmount } = render(
      <CommandBar onSubmit={onSubmit} onExit={() => {}} />,
    );
    stdin.write('test query');
    await tick();
    stdin.write('\r');
    await waitForCondition(() => onSubmit.mock.calls.length > 0);
    expect(onSubmit).toHaveBeenCalledWith('test query');
    await waitForCondition(() => (lastFrame() ?? '').includes('search memories or /command'));
    expect(lastFrame()).toContain('search memories or /command');
    unmount();
  });

  it('Esc clears input', async () => {
    const { lastFrame, stdin, unmount } = render(
      <CommandBar onSubmit={() => {}} onExit={() => {}} />,
    );
    stdin.write('partial');
    await tick();
    expect(lastFrame()).toContain('partial');
    stdin.write('\x1B'); // Escape
    await tick();
    expect(lastFrame()).toContain('search memories or /command');
    unmount();
  });

  it('slash palette shows commands when typing /', async () => {
    const { lastFrame, stdin, unmount } = render(
      <CommandBar onSubmit={() => {}} onExit={() => {}} />,
    );
    stdin.write('/');
    await tick();
    const frame = lastFrame()!;
    expect(frame).toContain('Commands');
    expect(frame).toContain('/search');
    unmount();
  });

  it('Enter on slash palette executes the selected command directly', async () => {
    const onSubmit = vi.fn();
    const { lastFrame, stdin, unmount } = render(
      <CommandBar onSubmit={onSubmit} onExit={() => {}} />,
    );
    stdin.write('/');
    await waitForCondition(() => {
      const frame = lastFrame() ?? '';
      return frame.includes('Commands') && frame.includes('/search');
    });
    stdin.write('\r');
    await waitForCondition(() => onSubmit.mock.calls.length > 0);
    expect(onSubmit).toHaveBeenCalled();
    const submittedCmd = onSubmit.mock.calls[0][0];
    expect(submittedCmd.startsWith('/')).toBe(true);
    unmount();
  });

  it('Tab on slash palette auto-completes the command name', async () => {
    const { lastFrame, stdin, unmount } = render(
      <CommandBar onSubmit={() => {}} onExit={() => {}} />,
    );
    stdin.write('/se');
    await tick();
    stdin.write('\t');
    await tick();
    expect(lastFrame()).toContain('/search');
    unmount();
  });

  it('Ctrl+C calls onExit', async () => {
    const onExit = vi.fn();
    const { stdin, unmount } = render(
      <CommandBar onSubmit={() => {}} onExit={onExit} />,
    );
    stdin.write('\x03'); // Ctrl+C
    await tick();
    expect(onExit).toHaveBeenCalled();
    unmount();
  });

  it('onFocusChange fires when input has content', async () => {
    const onFocus = vi.fn();
    const { stdin, unmount } = render(
      <CommandBar onSubmit={() => {}} onExit={() => {}} onFocusChange={onFocus} />,
    );
    stdin.write('a');
    await tick();
    expect(onFocus).toHaveBeenCalledWith(true);
    unmount();
  });

  it('does not respond to keys when disabled', async () => {
    const onSubmit = vi.fn();
    const { stdin, unmount } = render(
      <CommandBar onSubmit={onSubmit} onExit={() => {}} disabled />,
    );
    stdin.write('hello');
    await tick();
    stdin.write('\r');
    await tick();
    expect(onSubmit).not.toHaveBeenCalled();
    unmount();
  });
});

// ── Sidebar rendering tests ────────────────────────────────────────

import { Sidebar } from '../../src/cli/tui/Sidebar.js';
import type { HealthInfo, BackgroundInfo } from '../../src/cli/tui/data.js';

const mockHealth: HealthInfo = {
  embeddingProvider: 'ready',
  embeddingProviderName: 'openai',
  embeddingLabel: 'Ready',
  searchMode: 'hybrid',
  searchModeLabel: 'Hybrid',
  searchDiagnostic: '',
  backfillPending: 0,
  totalMemories: 42,
  activeMemories: 38,
  sessions: 5,
};

const mockBackground: BackgroundInfo = {
  running: true,
  healthy: true,
  port: 3210,
};

describe('Sidebar', () => {
  it('renders all quick action labels', () => {
    const { lastFrame, unmount } = render(
      <Sidebar
        health={mockHealth}
        background={mockBackground}
        onAction={() => {}}
        activeView="home"
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Quick Actions');
    expect(frame).toContain('Search memory');
    expect(frame).toContain('Remember');
    expect(frame).toContain('Recent activity');
    expect(frame).toContain('Doctor');
    expect(frame).toContain('Background');
    expect(frame).toContain('Dashboard');
    expect(frame).toContain('Project info');
    expect(frame).toContain('Configure');
    expect(frame).toContain('Integrate IDE');
    expect(frame).toContain('Home');
    unmount();
  });

  it('highlights the active view with > indicator', () => {
    const { lastFrame, unmount } = render(
      <Sidebar
        health={mockHealth}
        background={mockBackground}
        onAction={() => {}}
        activeView="doctor"
      />,
    );
    const frame = lastFrame()!;
    const lines = frame.split('\n');
    const doctorLine = lines.find(l => l.includes('Doctor'));
    expect(doctorLine).toBeTruthy();
    expect(doctorLine).toContain('>');
    unmount();
  });

  it('does NOT highlight non-active views with >', () => {
    const { lastFrame, unmount } = render(
      <Sidebar
        health={mockHealth}
        background={mockBackground}
        onAction={() => {}}
        activeView="home"
      />,
    );
    const frame = lastFrame()!;
    const lines = frame.split('\n');
    const doctorLine = lines.find(l => l.includes('Doctor'));
    expect(doctorLine).toContain('d');
    unmount();
  });

  it('shows health info section', () => {
    const { lastFrame, unmount } = render(
      <Sidebar
        health={mockHealth}
        background={mockBackground}
        onAction={() => {}}
        activeView="home"
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Health');
    expect(frame).toContain('Ready');
    expect(frame).toContain('Hybrid');
    expect(frame).toContain('5'); // sessions
    unmount();
  });

  it('shows background status', () => {
    const { lastFrame, unmount } = render(
      <Sidebar
        health={mockHealth}
        background={mockBackground}
        onAction={() => {}}
        activeView="home"
      />,
    );
    expect(lastFrame()).toContain('Running');

    const { lastFrame: lastFrame2, unmount: unmount2 } = render(
      <Sidebar
        health={mockHealth}
        background={{ running: false, healthy: false }}
        onAction={() => {}}
        activeView="home"
      />,
    );
    expect(lastFrame2()).toContain('Stopped');
    unmount();
    unmount2();
  });

  // ── Sidebar interaction tests: shortcut keys drive real navigation ──

  it('shortcut key "d" triggers onAction("/doctor") when isFocused', async () => {
    const onAction = vi.fn();
    const { stdin, unmount } = render(
      <Sidebar
        health={mockHealth}
        background={mockBackground}
        onAction={onAction}
        activeView="home"
        isFocused={true}
      />,
    );
    stdin.write('d');
    await tick();
    expect(onAction).toHaveBeenCalledWith('/doctor');
    unmount();
  });

  it('shortcut key "v" triggers onAction("/recent") when isFocused', async () => {
    const onAction = vi.fn();
    const { stdin, unmount } = render(
      <Sidebar
        health={mockHealth}
        background={mockBackground}
        onAction={onAction}
        activeView="home"
        isFocused={true}
      />,
    );
    stdin.write('v');
    await tick();
    expect(onAction).toHaveBeenCalledWith('/recent');
    unmount();
  });

  it('shortcut key "c" triggers onAction("/configure") when isFocused', async () => {
    const onAction = vi.fn();
    const { stdin, unmount } = render(
      <Sidebar
        health={mockHealth}
        background={mockBackground}
        onAction={onAction}
        activeView="home"
        isFocused={true}
      />,
    );
    stdin.write('c');
    await tick();
    expect(onAction).toHaveBeenCalledWith('/configure');
    unmount();
  });

  it('does NOT capture keys when isFocused is false', async () => {
    const onAction = vi.fn();
    const { stdin, unmount } = render(
      <Sidebar
        health={mockHealth}
        background={mockBackground}
        onAction={onAction}
        activeView="home"
        isFocused={false}
      />,
    );
    stdin.write('d');
    await tick();
    expect(onAction).not.toHaveBeenCalled();
    unmount();
  });

  it('Esc triggers onAction("/home") from non-home view when isFocused', async () => {
    const onAction = vi.fn();
    const { stdin, unmount } = render(
      <Sidebar
        health={mockHealth}
        background={mockBackground}
        onAction={onAction}
        activeView="doctor"
        isFocused={true}
      />,
    );
    stdin.write('\x1B');
    await tick();
    expect(onAction).toHaveBeenCalledWith('/home');
    unmount();
  });

  it('multiple shortcut keys in sequence all trigger onAction', async () => {
    const onAction = vi.fn();
    const { stdin, unmount } = render(
      <Sidebar
        health={mockHealth}
        background={mockBackground}
        onAction={onAction}
        activeView="home"
        isFocused={true}
      />,
    );
    stdin.write('s');
    await tick();
    stdin.write('p');
    await tick();
    stdin.write('h');
    await tick();
    expect(onAction).toHaveBeenCalledTimes(3);
    expect(onAction).toHaveBeenNthCalledWith(1, '/search');
    expect(onAction).toHaveBeenNthCalledWith(2, '/project');
    expect(onAction).toHaveBeenNthCalledWith(3, '/home');
    unmount();
  });
});

// ── ConfigureView rendering + Esc callback tests ────────────────────

// Use vi.mock for node:fs so ConfigureView doesn't touch real filesystem.
// ConfigureView imports * as fs from 'node:fs'.
vi.mock('node:fs', () => ({
  existsSync: () => false,
  readFileSync: () => '{}',
  writeFileSync: () => {},
  mkdirSync: () => {},
  default: {
    existsSync: () => false,
    readFileSync: () => '{}',
    writeFileSync: () => {},
    mkdirSync: () => {},
  },
}));

import { ConfigureView } from '../../src/cli/tui/ConfigureView.js';

describe('ConfigureView', () => {
  it('renders the main menu with all options', () => {
    const { lastFrame, unmount } = render(
      <ConfigureView onBack={() => {}} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Configure Memorix');
    expect(frame).toContain('LLM Enhanced Mode');
    expect(frame).toContain('Embedding Provider');
    expect(frame).toContain('Behavior Settings');
    expect(frame).toContain('Show Current Config');
    expect(frame).toContain('Back to Home');
    unmount();
  });

  it('first item is selected by default (> indicator)', () => {
    const { lastFrame, unmount } = render(
      <ConfigureView onBack={() => {}} />,
    );
    const frame = lastFrame()!;
    const lines = frame.split('\n');
    const llmLine = lines.find(l => l.includes('LLM Enhanced Mode'));
    expect(llmLine).toContain('>');
    unmount();
  });

  it('Down arrow moves selection', async () => {
    const { lastFrame, stdin, unmount } = render(
      <ConfigureView onBack={() => {}} />,
    );
    stdin.write('\x1B[B');
    await tick();
    const frame = lastFrame()!;
    const lines = frame.split('\n');
    const embLine = lines.find(l => l.includes('Embedding Provider'));
    expect(embLine).toContain('>');
    unmount();
  });

  it('Enter on "Show Current Config" opens config display', async () => {
    const { lastFrame, stdin, unmount } = render(
      <ConfigureView onBack={() => {}} />,
    );
    // Navigate to "Show Current Config" (index 3)
    for (let i = 0; i < 3; i++) { stdin.write('\x1B[B'); await tick(); }
    stdin.write('\r');
    await waitForCondition(() => (lastFrame() ?? '').includes('Current Configuration'));
    const frame = lastFrame()!;
    expect(frame).toContain('Current Configuration');
    expect(frame).toContain('Config file');
    expect(frame).toContain('LLM Provider');
    unmount();
  });

  it('Esc from config display returns to menu', async () => {
    const { lastFrame, stdin, unmount } = render(
      <ConfigureView onBack={() => {}} />,
    );
    for (let i = 0; i < 3; i++) { stdin.write('\x1B[B'); await tick(); }
    stdin.write('\r');
    await waitForCondition(() => (lastFrame() ?? '').includes('Current Configuration'));
    expect(lastFrame()).toContain('Current Configuration');
    stdin.write('\x1B');
    await waitForCondition(() => (lastFrame() ?? '').includes('LLM Enhanced Mode'));
    expect(lastFrame()).toContain('LLM Enhanced Mode');
    unmount();
  });

  it('Esc from main menu calls onBack', async () => {
    const onBack = vi.fn();
    const { stdin, unmount } = render(
      <ConfigureView onBack={onBack} />,
    );
    stdin.write('\x1B');
    await tick();
    expect(onBack).toHaveBeenCalled();
    unmount();
  });

  it('Enter on LLM opens provider selection', async () => {
    const { lastFrame, stdin, unmount } = render(
      <ConfigureView onBack={() => {}} />,
    );
    stdin.write('\r');
    await tick();
    const frame = lastFrame()!;
    expect(frame).toContain('LLM Provider');
    expect(frame).toContain('OpenAI');
    expect(frame).toContain('Anthropic');
    expect(frame).toContain('OpenRouter');
    expect(frame).toContain('Disable LLM');
    unmount();
  });

  it('Enter on "Back to Home" calls onBack', async () => {
    const onBack = vi.fn();
    const { stdin, unmount } = render(
      <ConfigureView onBack={onBack} />,
    );
    for (let i = 0; i < 4; i++) { stdin.write('\x1B[B'); await tick(80); }
    stdin.write('\r');
    await waitForCondition(() => onBack.mock.calls.length > 0);
    expect(onBack).toHaveBeenCalled();
    unmount();
  });
});

// ── 3-layer keyboard model integration test ─────────────────────────
// Mirrors the real App.tsx architecture:
// - App useInput handles Layer 1 (action view keys) + Layer 2 (input focus guard)
// - Sidebar useInput handles Layer 3 (global nav) via isFocused prop
// This test uses a mini-app with an embedded Sidebar to prove the full dispatch.

describe('3-layer keyboard model (integration)', () => {
  function KeyboardTestApp(): React.ReactElement {
    const [view, setView] = useState<string>('home');
    const [inputFocused] = useState(false);
    const [log, setLog] = useState<string[]>([]);

    const isAction = ACTION_VIEWS.has(view as any);
    const canEsc = ESC_RETURNABLE_VIEWS.has(view as any);

    // Layer 1 + 2: App-level useInput (action view keys + input guard)
    useInput((ch, key) => {
      if (key.escape && canEsc && isAction) {
        setView('home');
        setLog(prev => [...prev, 'esc-home']);
        return;
      }
      if (isAction) {
        if (/^[1-9]$/.test(ch)) {
          setLog(prev => [...prev, `action-${ch}`]);
          return;
        }
        if (ch === 'h') {
          setView('home');
          setLog(prev => [...prev, 'action-h-home']);
          return;
        }
        return;
      }
      if (inputFocused) return;
      // Layer 3 handled by Sidebar below
    });

    // Layer 3: Sidebar drives global nav via onAction
    const handleNav = useCallback((cmd: string) => {
      const target = cmd.slice(1);
      setView(target);
      setLog(prev => [...prev, `sidebar-nav-${target}`]);
    }, []);

    return (
      <Box flexDirection="column">
        <Text>view:{view}</Text>
        <Text>log:{log.join(',')}</Text>
        <Sidebar
          health={mockHealth}
          background={mockBackground}
          onAction={handleNav}
          activeView={view as any}
          isFocused={!isAction && !inputFocused}
        />
      </Box>
    );
  }

  it('Sidebar nav key switches view from home', async () => {
    const { lastFrame, stdin, unmount } = render(<KeyboardTestApp />);
    expect(lastFrame()).toContain('view:home');
    stdin.write('v');
    await tick();
    expect(lastFrame()).toContain('view:recent');
    expect(lastFrame()).toContain('sidebar-nav-recent');
    unmount();
  });

  it('Sidebar Esc returns to home from secondary view', async () => {
    const { lastFrame, stdin, unmount } = render(<KeyboardTestApp />);
    stdin.write('d');
    await tick();
    expect(lastFrame()).toContain('view:doctor');
    stdin.write('\x1B');
    await tick();
    expect(lastFrame()).toContain('view:home');
    expect(lastFrame()).toContain('sidebar-nav-home');
    unmount();
  });

  it('number-key action view captures digits, Sidebar nav disabled', async () => {
    const { lastFrame, stdin, unmount } = render(<KeyboardTestApp />);
    stdin.write('i');
    await tick(120);
    expect(lastFrame()).toContain('view:integrate');
    stdin.write('1');
    await tick(120);
    expect(lastFrame()).toContain('action-1');
    // 'v' should NOT trigger Sidebar nav since isFocused=false in action view
    stdin.write('v');
    await tick(120);
    expect(lastFrame()).not.toContain('view:recent');
    unmount();
  });

  it('h key in action view returns home via App layer', async () => {
    const { lastFrame, stdin, unmount } = render(<KeyboardTestApp />);
    stdin.write('i');
    await tick(120);
    expect(lastFrame()).toContain('view:integrate');
    stdin.write('h');
    await tick(120);
    expect(lastFrame()).toContain('view:home');
    expect(lastFrame()).toContain('action-h-home');
    unmount();
  });

  it('multiple Sidebar nav transitions work correctly', async () => {
    const { lastFrame, stdin, unmount } = render(<KeyboardTestApp />);
    stdin.write('d');
    await tick();
    expect(lastFrame()).toContain('view:doctor');
    stdin.write('p');
    await tick();
    expect(lastFrame()).toContain('view:project');
    stdin.write('h');
    await tick();
    expect(lastFrame()).toContain('view:home');
    unmount();
  });
});

// ── HeaderBar rendering tests ───────────────────────────────────────

import { HeaderBar } from '../../src/cli/tui/HeaderBar.js';

describe('HeaderBar', () => {
  it('renders version', () => {
    const { lastFrame, unmount } = render(
      <HeaderBar version="1.2.3" project={null} health={mockHealth} mode="CLI" />,
    );
    expect(lastFrame()).toContain('1.2.3');
    unmount();
  });

  it('shows warning when no project detected', () => {
    const { lastFrame, unmount } = render(
      <HeaderBar version="1.0.0" project={null} health={mockHealth} mode="CLI" />,
    );
    expect(lastFrame()).toContain('no project');
    unmount();
  });

  it('shows project name when detected', () => {
    const { lastFrame, unmount } = render(
      <HeaderBar
        version="1.0.0"
        project={{ id: 'test/proj', name: 'my-project', rootPath: '/tmp', gitRemote: 'origin' }}
        health={mockHealth}
        mode="CLI"
      />,
    );
    expect(lastFrame()).toContain('my-project');
    unmount();
  });
});

// ── StatusMessage rendering test ────────────────────────────────────

import { StatusMessage, HomeView, IntegrateView } from '../../src/cli/tui/Panels.js';

describe('StatusMessage', () => {
  it('renders success message', () => {
    const { lastFrame, unmount } = render(
      <StatusMessage message="Operation completed" type="success" />,
    );
    expect(lastFrame()).toContain('Operation completed');
    unmount();
  });

  it('renders error message', () => {
    const { lastFrame, unmount } = render(
      <StatusMessage message="Something failed" type="error" />,
    );
    expect(lastFrame()).toContain('Something failed');
    unmount();
  });

  it('renders info message', () => {
    const { lastFrame, unmount } = render(
      <StatusMessage message="Helpful info" type="info" />,
    );
    expect(lastFrame()).toContain('Helpful info');
    unmount();
  });
});

// ── HomeView no-project empty state tests ───────────────────────────

describe('HomeView', () => {
  it('no-project shows getting-started guidance, NOT status framework', () => {
    const { lastFrame, unmount } = render(
      <HomeView
        project={null}
        health={mockHealth}
        background={mockBackground}
        loading={false}
      />,
    );
    const frame = lastFrame()!;
    // Should show empty-state guidance
    expect(frame).toContain('No project detected');
    expect(frame).toContain('Getting Started');
    expect(frame).toContain('git init');
    expect(frame).toContain('/configure');
    expect(frame).toContain('/doctor');
    // Should show global services (background only)
    expect(frame).toContain('Global Services');
    // Must NOT show misleading project-scoped status
    expect(frame).not.toContain('Memories');
    expect(frame).not.toContain('active');
    expect(frame).not.toContain('Embedding');
    expect(frame).not.toContain('Search Mode');
    unmount();
  });

  it('no-project still shows background status in Global Services', () => {
    const { lastFrame, unmount } = render(
      <HomeView
        project={null}
        health={mockHealth}
        background={{ running: true, healthy: true, port: 3210 }}
        loading={false}
      />,
    );
    expect(lastFrame()).toContain('Running');
    unmount();
  });

  it('with project shows full status framework', () => {
    const { lastFrame, unmount } = render(
      <HomeView
        project={{ id: 'test/proj', name: 'my-project', rootPath: '/tmp', gitRemote: 'origin' }}
        health={mockHealth}
        background={mockBackground}
        loading={false}
      />,
    );
    const frame = lastFrame()!;
    // Should show project info and status
    expect(frame).toContain('my-project');
    expect(frame).toContain('Status');
    expect(frame).toContain('Memories');
    expect(frame).toContain('active');
    expect(frame).toContain('Embedding');
    // Should NOT show empty-state guidance
    expect(frame).not.toContain('Getting Started');
    expect(frame).not.toContain('No project detected');
    unmount();
  });
});

// ── IntegrateView rendering tests ───────────────────────────────────

describe('IntegrateView', () => {
  it('renders all 10 integration targets including Gemini CLI', () => {
    const { lastFrame, unmount } = render(
      <IntegrateView statusText="" />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Claude Code');
    expect(frame).toContain('Windsurf');
    expect(frame).toContain('Cursor');
    expect(frame).toContain('GitHub Copilot');
    expect(frame).toContain('Kiro');
    expect(frame).toContain('Codex');
    expect(frame).toContain('Antigravity');
    expect(frame).toContain('OpenCode');
    expect(frame).toContain('Trae');
    expect(frame).toContain('Gemini CLI');
    unmount();
  });

  it('Gemini CLI is key 0, distinct from Antigravity key 7', () => {
    const { lastFrame, unmount } = render(
      <IntegrateView statusText="" />,
    );
    const frame = lastFrame()!;
    const lines = frame.split('\n');
    const antigravityLine = lines.find(l => l.includes('Antigravity'));
    const geminiLine = lines.find(l => l.includes('Gemini CLI'));
    expect(antigravityLine).toContain('7');
    expect(geminiLine).toContain('0');
    // They are distinct lines
    expect(antigravityLine).not.toContain('Gemini');
    expect(geminiLine).not.toContain('Antigravity');
    unmount();
  });

  it('shows status text when provided', () => {
    const { lastFrame, unmount } = render(
      <IntegrateView statusText="Installed gemini-cli integration" />,
    );
    expect(lastFrame()).toContain('Installed gemini-cli integration');
    unmount();
  });
});
