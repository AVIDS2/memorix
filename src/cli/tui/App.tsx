/**
 * WorkbenchApp — Memorix TUI with tab-based navigation.
 *
 * Layout: HeaderBar + TabBar + (MainContent | ContextRail) + StatusMessage + CommandBar
 * 5 tabs: Home, Knowledge, Memory, Workbench, Graph.
 * Slash commands map to overlays (secondary views) that temporarily replace tab content.
 * Cross-view navigation via focusRef state.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useStdout, useInput } from 'ink';
import {
  COLORS, SLASH_COMMANDS, COMMAND_BAR_ROWS,
  computeLayoutWidths, getCommandPaletteHeight, getStatusMessageRows,
} from './theme.js';
import type { ViewType } from './theme.js';
import { TabBar, TABS } from './components/TabBar.js';
import type { TabDef } from './components/TabBar.js';
import { HeaderBar } from './HeaderBar.js';
import { CommandBar } from './CommandBar.js';
import type { PaletteItem } from './CommandBar.js';
import {
  RecentView,
  SearchResultsView,
  DoctorView,
  ProjectView,
  BackgroundView,
  DashboardView,
  CleanupView,
  IngestView,
  IntegrateView,
  WikiView,
  StatusMessage,
} from './Panels.js';
import { ConfigureView } from './ConfigureView.js';
import { HomeView } from './views/HomeView.js';
import { KnowledgeView } from './views/KnowledgeView.js';
import { MemoryView } from './views/MemoryView.js';
import { WorkbenchView } from './views/WorkbenchView.js';
import { GraphView } from './views/GraphView.js';
import type { MemoryNavTarget } from './views/MemoryView.js';
import { ChatView } from './ChatView.js';
import type { ChatTranscriptMessage, ChatViewRef } from './ChatView.js';
import { ContextRail } from './ContextRail.js';
import { askMemoryQuestionStream } from './chat-service.js';
import type { ChatAnswer } from './chat-service.js';
import type {
  ProjectInfo,
  HealthInfo,
  BackgroundInfo,
  MemoryItem,
  SearchResult,
  DoctorResult,
} from './data.js';
import {
  getProjectInfo,
  getHealthInfo,
  getRecentMemories,
  getBackgroundStatus,
  searchMemories,
  storeQuickMemory,
  getDoctorSummary,
  getKnowledgeBase,
  detectMode,
} from './data.js';

// ── Types ────────────────────────────────────────────────────────
type TabType = 'home' | 'knowledge' | 'memory' | 'workbench' | 'graph';

const INPUT_BLOCKING_OVERLAYS = new Set<ViewType>([
  'cleanup',
  'ingest',
  'background',
  'dashboard',
  'integrate',
  'configure',
]);

interface FocusRef {
  tab: TabType;
  refId: string;
}

interface AppProps {
  version: string;
  onExitForInteractive: (cmd: string) => void;
}

function createThreadId(): string {
  return `t${Date.now().toString(36)}`;
}

// ── Component ────────────────────────────────────────────────────
export function WorkbenchApp({ version, onExitForInteractive }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const MAX_CHAT_MESSAGES = 100;

  // ── Core state ───────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [overlayView, setOverlayView] = useState<ViewType | null>(null);
  const [focusRef, setFocusRef] = useState<FocusRef | null>(null);
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [health, setHealth] = useState<HealthInfo>({
    embeddingProvider: 'disabled', embeddingProviderName: undefined,
    embeddingLabel: 'Disabled', searchMode: 'fulltext', searchModeLabel: 'BM25 full-text',
    searchDiagnostic: '', backfillPending: 0, totalMemories: 0, activeMemories: 0, sessions: 0,
  });
  const [background, setBackground] = useState<BackgroundInfo>({ running: false, healthy: false });
  const [recentMemories, setRecentMemories] = useState<MemoryItem[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [doctor, setDoctor] = useState<DoctorResult | null>(null);
  const [knowledge, setKnowledge] = useState<import('../../wiki/types.js').ProjectKnowledgeOverview | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [mode, setMode] = useState('CLI');
  const [actionStatus, setActionStatus] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatTranscriptMessage[]>([]);
  const [chatThreadId, setChatThreadId] = useState<string>(() => createThreadId());
  const [lastChat, setLastChat] = useState<ChatAnswer | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [paletteVisible, setPaletteVisible] = useState(false);
  const [paletteItems, setPaletteItems] = useState<PaletteItem[]>([]);
  const [paletteSelectedIdx, setPaletteSelectedIdx] = useState(0);
  const [knowledgeSelectedIdx, setKnowledgeSelectedIdx] = useState(0);
  const [memorySelectedIdx, setMemorySelectedIdx] = useState(0);
  const chatViewRef = useRef<ChatViewRef>(null);
  const chatAbortRef = useRef<AbortController | null>(null);

  const effectiveView = overlayView ?? activeTab;
  const commandBarDisabled = overlayView ? INPUT_BLOCKING_OVERLAYS.has(overlayView) : false;
  const canSubmitChat = !overlayView || overlayView === 'chat' || !commandBarDisabled;

  const handlePaletteItemsChange = useCallback((items: PaletteItem[], idx: number) => {
    setPaletteItems(items);
    setPaletteSelectedIdx(idx);
  }, []);

  const getProjectRoot = useCallback(async (): Promise<string | null> => {
    const detected = project?.rootPath;
    if (detected) return detected;
    const { detectProject } = await import('../../project/detector.js');
    return detectProject(process.cwd())?.rootPath ?? null;
  }, [project]);

  const refreshSummary = useCallback(async () => {
    const [recent, bg, h] = await Promise.all([
      getRecentMemories(8, project?.id),
      getBackgroundStatus(),
      getHealthInfo(project?.id),
    ]);
    setRecentMemories(recent);
    setBackground(bg);
    setHealth(h);
  }, [project]);

  // ── Cross-view navigation ────────────────────────────────────
  const navigateTo = useCallback((tab: TabType, refId?: string) => {
    setOverlayView(null);
    setActiveTab(tab);
    if (refId) {
      setFocusRef({ tab, refId });
    }
  }, []);

  // Clear focusRef when tab changes without a new ref
  useEffect(() => {
    if (focusRef && focusRef.tab !== activeTab) {
      // Focus was for a different tab, clear it
    }
  }, [activeTab, focusRef]);

  // ── Keyboard dispatch (3 layers) ──────────────────────────────
  useInput((ch, key) => {
    // Esc while LLM thinking in chat overlay
    if (key.escape && loading && overlayView === 'chat' && chatAbortRef.current) {
      cancelChat();
      return;
    }

    // Esc: dismiss overlay → back to tab
    if (key.escape && overlayView) {
      setOverlayView(null);
      return;
    }

    // Tab switching: Alt+1..5
    if (key.meta) {
      const num = parseInt(ch, 10);
      if (num >= 1 && num <= 5) {
        setOverlayView(null);
        setFocusRef(null);
        setActiveTab(TABS[num - 1].id as TabType);
        return;
      }
    }

    // Tab switching: Ctrl+Left / Ctrl+Right
    if (key.ctrl && key.leftArrow) {
      const idx = TABS.findIndex(t => t.id === activeTab);
      setOverlayView(null);
      setFocusRef(null);
      setActiveTab(TABS[Math.max(0, idx - 1)].id as TabType);
      return;
    }
    if (key.ctrl && key.rightArrow) {
      const idx = TABS.findIndex(t => t.id === activeTab);
      setOverlayView(null);
      setFocusRef(null);
      setActiveTab(TABS[Math.min(TABS.length - 1, idx + 1)].id as TabType);
      return;
    }

    // In-tab keyboard: Knowledge view
    if (activeTab === 'knowledge' && !overlayView && !inputFocused) {
      if (key.upArrow) { setKnowledgeSelectedIdx(Math.max(0, knowledgeSelectedIdx - 1)); return; }
      if (key.downArrow) { setKnowledgeSelectedIdx(knowledgeSelectedIdx + 1); return; }
      if (ch === 'm' && knowledge) {
        // Jump to Memory with selected item's first ref
        const flatIdx = findFlatKnowledgeItem(knowledge, knowledgeSelectedIdx);
        if (flatIdx && flatIdx.refs.length > 0) {
          navigateTo('memory', flatIdx.refs[0].id);
          setFocusRef({ tab: 'memory', refId: flatIdx.refs[0].id });
        }
        return;
      }
    }

    // In-tab keyboard: Memory view
    // ↑↓ navigation handled here; k → Knowledge jump handled by MemoryView's own useInput
    if (activeTab === 'memory' && !overlayView && !inputFocused) {
      if (key.upArrow) { setMemorySelectedIdx(Math.max(0, memorySelectedIdx - 1)); return; }
      if (key.downArrow) { setMemorySelectedIdx(memorySelectedIdx + 1); return; }
    }

    // In-tab keyboard: Workbench view
    // Session bind/end is handled by WorkbenchView's own useInput (Enter key).

    // Action view keys (cleanup, ingest, background, dashboard, integrate)
    if (overlayView && INPUT_BLOCKING_OVERLAYS.has(overlayView)) {
      const av = overlayView;
      if (av === 'cleanup' && /^[1-3]$/.test(ch)) { handleCleanupAction(ch); return; }
      if (av === 'ingest' && /^[1-4]$/.test(ch)) { handleIngestAction(ch); return; }
      if (av === 'integrate' && /^[0-9]$/.test(ch)) { handleIntegrateAction(ch); return; }
      if (av === 'background' && /^[1-3w]$/.test(ch)) { handleBackgroundAction(ch); return; }
      if (av === 'dashboard' && /^[1-2]$/.test(ch)) { handleDashboardAction(ch); return; }
      if (ch === 'h') { setOverlayView(null); return; }
      return;
    }

    // CommandBar input mode
    if (inputFocused) return;

    // Global: / opens CommandBar
    if (ch === '/' && !inputFocused) {
      // Let CommandBar handle it
    }
  });

  // ── Initial load ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const proj = await getProjectInfo();
        const [recent, bg] = await Promise.all([
          getRecentMemories(8, proj?.id),
          getBackgroundStatus(),
        ]);
        if (cancelled) return;
        setProject(proj);
        setRecentMemories(recent);
        setBackground(bg);

        const h = await getHealthInfo(proj?.id);
        if (cancelled) return;
        setHealth(h);

        const m = detectMode();
        setMode(m.mode);
        setStatusMsg({ text: 'New chat ready — type a question to start  |  Alt+1..5 tabs', type: 'info' });

        if (proj) {
          try {
            const { getProjectDataDir } = await import('../../store/persistence.js');
            const { getChatStore } = await import('../../store/chat-store.js');
            const dataDir = await getProjectDataDir(proj.id);
            const store = getChatStore();
            await store.init(dataDir);
            const latestThreadId = store.getLatestThreadId(proj.id);
            setStatusMsg({
              text: latestThreadId
                ? 'New chat ready — type a question or use /resume to continue a saved thread'
                : 'New chat ready — type a question to start',
              type: 'info',
            });
          } catch { /* non-fatal */ }
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const CHAT_GLOBAL_TIMEOUT_MS = 90_000;

  const cancelChat = useCallback(() => {
    if (chatAbortRef.current) {
      chatAbortRef.current.abort('User cancelled');
      chatAbortRef.current = null;
    }
  }, []);

  const submitChatQuestion = useCallback(async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;
    cancelChat();
    const ac = new AbortController();
    chatAbortRef.current = ac;
    const globalTimer = setTimeout(() => ac.abort('Chat timed out'), CHAT_GLOBAL_TIMEOUT_MS);

    const userMessage: ChatTranscriptMessage = { role: 'user', content: trimmed, timestamp: new Date().toISOString() };
    const history = chatMessages.map((m) => ({ role: m.role, content: m.content }));

    setOverlayView('chat');
    setLoading(true);
    setChatMessages((prev) => {
      const next = [...prev, userMessage];
      return next.length > MAX_CHAT_MESSAGES ? next.slice(-MAX_CHAT_MESSAGES) : next;
    });

    // Persist user message
    try {
      if (project) {
        const { getProjectDataDir } = await import('../../store/persistence.js');
        const { getChatStore } = await import('../../store/chat-store.js');
        const dataDir = await getProjectDataDir(project.id);
        const store = getChatStore();
        await store.init(dataDir);
        store.append(project.id, chatThreadId, userMessage);
      }
    } catch { /* non-fatal */ }

    const streamingMsg: ChatTranscriptMessage = { role: 'assistant', content: '', timestamp: new Date().toISOString(), meta: { usedLLM: true } };
    setChatMessages((prev) => {
      const next = [...prev, streamingMsg];
      return next.length > MAX_CHAT_MESSAGES ? next.slice(-MAX_CHAT_MESSAGES) : next;
    });

    try {
      const result = await askMemoryQuestionStream(trimmed, history, {
        onChunk: (text) => {
          setChatMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              updated[lastIdx] = { ...updated[lastIdx], content: updated[lastIdx].content + text };
            }
            return updated;
          });
        },
        onToolCall: (name) => {
          setChatMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              updated[lastIdx] = { ...updated[lastIdx], content: `Searching memories (${name})…` };
            }
            return updated;
          });
        },
      }, ac.signal);

      const assistantMessage: ChatTranscriptMessage = {
        role: 'assistant', content: result.answer, sources: result.sources,
        timestamp: new Date().toISOString(), error: false,
        meta: { usedLLM: result.usedLLM, searchMode: result.searchMode, llmModel: result.llmModel, warning: result.warning },
      };
      setLastChat(result);
      setChatMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') updated[lastIdx] = assistantMessage;
        return updated;
      });
      setHealth(await getHealthInfo(project?.id));
      // Persist
      try {
        if (project) {
          const { getProjectDataDir } = await import('../../store/persistence.js');
          const { getChatStore } = await import('../../store/chat-store.js');
          const dataDir = await getProjectDataDir(project.id);
          const store = getChatStore();
          await store.init(dataDir);
          store.append(project.id, chatThreadId, assistantMessage);
        }
      } catch { /* non-fatal */ }
    } catch (err) {
      const isCancelled = (err instanceof Error && err.message === 'User cancelled') ||
        (err instanceof DOMException && err.name === 'AbortError');
      const errorMsg: ChatTranscriptMessage = {
        role: 'assistant', content: isCancelled ? 'Chat cancelled.' : `Chat failed: ${err instanceof Error ? err.message : String(err)}`,
        error: !isCancelled, timestamp: new Date().toISOString(),
      };
      setChatMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') updated[lastIdx] = errorMsg;
        return updated;
      });
    } finally {
      clearTimeout(globalTimer);
      chatAbortRef.current = null;
      setLoading(false);
    }
  }, [chatMessages, project, cancelChat]);

  // ── Command handler ───────────────────────────────────────────
  const handleCommand = useCallback(async (input: string) => {
    const raw = input.trim();
    if (!raw) return;
    setStatusMsg(null);

    if (raw.startsWith('/')) {
      const parts = raw.slice(1).split(/\s+/);
      const cmd = parts[0]?.toLowerCase() || '';
      const arg = parts.slice(1).join(' ');

      switch (cmd) {
        case 'chat': case 'ask': {
          if (!arg) {
            setOverlayView('chat');
            setStatusMsg({ text: 'Chat ready — type a question. Use /new for fresh thread, /resume to open saved', type: 'info' });
            return;
          }
          await submitChatQuestion(arg);
          break;
        }
        case 'clear': case 'cc': {
          setChatMessages([]);
          if (project) {
            try {
              const { getProjectDataDir } = await import('../../store/persistence.js');
              const { getChatStore } = await import('../../store/chat-store.js');
              const dataDir = await getProjectDataDir(project.id);
              const store = getChatStore();
              await store.init(dataDir);
              store.clear(project.id, chatThreadId);
            } catch { /* non-fatal */ }
          }
          setOverlayView('chat');
          setStatusMsg({ text: 'Chat cleared', type: 'info' });
          break;
        }
        case 'resume': case 'cr': {
          if (!project) { setStatusMsg({ text: 'No project detected', type: 'error' }); break; }
          try {
            const { getProjectDataDir } = await import('../../store/persistence.js');
            const { getChatStore } = await import('../../store/chat-store.js');
            const dataDir = await getProjectDataDir(project.id);
            const store = getChatStore();
            await store.init(dataDir);
            const threads = store.listThreads(project.id);
            if (threads.length === 0) {
              if (chatMessages.length > 0) {
                setOverlayView('chat');
                setStatusMsg({ text: `Current thread has ${chatMessages.length} messages`, type: 'info' });
              } else {
                setStatusMsg({ text: 'No saved threads. Start chatting with /chat or type a question.', type: 'info' });
              }
              break;
            }
            const numericIdx = arg && /^\d+$/.test(arg) ? parseInt(arg, 10) - 1 : -1;
            const target = numericIdx >= 0 && numericIdx < threads.length
              ? threads[numericIdx]
              : threads.find((t: any) => t.threadId === arg) || threads[0];
            const saved = store.load(project.id, target.threadId);
            setChatThreadId(target.threadId);
            setChatMessages(saved);
            setOverlayView('chat');
            setStatusMsg({ text: `Resumed thread ${target.threadId} (${saved.length} messages)`, type: 'success' });
          } catch (err) {
            setStatusMsg({ text: `Could not resume chat: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
          }
          break;
        }
        case 'new': case 'cn': {
          try {
            const { getChatStore } = await import('../../store/chat-store.js');
            const newId = getChatStore().newThreadId();
            setChatThreadId(newId);
          } catch { setChatThreadId(`t${Date.now().toString(36)}`); }
          setChatMessages([]);
          setOverlayView('chat');
          setStatusMsg({ text: `New thread ${chatThreadId}`, type: 'info' });
          break;
        }
        case 'search': case 's': {
          if (!arg) { setStatusMsg({ text: 'Usage: /search <query>', type: 'info' }); return; }
          setSearchQuery(arg);
          setLoading(true);
          navigateTo('memory');
          const results = await searchMemories(arg);
          setSearchResults(results);
          setRecentMemories(results as any);
          setMemorySelectedIdx(0);
          setLoading(false);
          setHealth(await getHealthInfo(project?.id));
          break;
        }
        case 'remember': case 'r': {
          if (!arg) { setStatusMsg({ text: 'Usage: /remember <text>', type: 'info' }); return; }
          setLoading(true);
          const stored = await storeQuickMemory(arg);
          setLoading(false);
          if (stored) {
            setStatusMsg({ text: `Stored #${stored.id}: ${stored.title}`, type: 'success' });
            const recent = await getRecentMemories(8, project?.id);
            setRecentMemories(recent);
            setHealth(await getHealthInfo(project?.id));
          } else {
            setStatusMsg({ text: 'Failed to store memory', type: 'error' });
          }
          break;
        }
        case 'recent': case 'v': {
          setLoading(true);
          const recent = await getRecentMemories(12, project?.id);
          setRecentMemories(recent);
          setLoading(false);
          navigateTo('memory');
          setStatusMsg({ text: `Showing ${recent.length} recent memories`, type: 'info' });
          break;
        }
        case 'home': case 'h': {
          setOverlayView(null);
          navigateTo('home');
          setStatusMsg({ text: 'Home', type: 'info' });
          break;
        }
        case 'cleanup': {
          setOverlayView('cleanup');
          setActionStatus('');
          setStatusMsg({ text: 'Cleanup: choose 1/2/3', type: 'info' });
          break;
        }
        case 'ingest': {
          setOverlayView('ingest');
          setActionStatus('');
          setStatusMsg({ text: 'Ingest: choose 1/2/3/4', type: 'info' });
          break;
        }
        case 'doctor': {
          setOverlayView('doctor');
          setLoading(true);
          const d = await getDoctorSummary();
          setDoctor(d);
          setLoading(false);
          setStatusMsg({ text: 'Diagnostics complete', type: 'info' });
          break;
        }
        case 'project': case 'status': {
          setOverlayView('project');
          setStatusMsg({ text: project ? `Project: ${project.name}` : 'No project detected', type: 'info' });
          break;
        }
        case 'background': case 'bg': {
          setOverlayView('background');
          setLoading(true);
          const bg = await getBackgroundStatus();
          setBackground(bg);
          setLoading(false);
          setStatusMsg({ text: bg.running ? 'Background running' : 'Background stopped', type: 'info' });
          break;
        }
        case 'dashboard': case 'dash': {
          setOverlayView('dashboard');
          const bg = await getBackgroundStatus();
          setBackground(bg);
          break;
        }
        case 'integrate': case 'setup': {
          setOverlayView('integrate');
          setActionStatus('');
          setStatusMsg({ text: 'Integrate: choose 0-9 for IDE', type: 'info' });
          break;
        }
        case 'configure': case 'config': {
          setOverlayView('configure');
          setStatusMsg({ text: 'Configure: Up/Down/Enter, Esc to back', type: 'info' });
          break;
        }
        case 'wiki': case 'knowledge': {
          setLoading(true);
          const kb = await getKnowledgeBase(project?.id);
          setKnowledge(kb);
          setKnowledgeSelectedIdx(0);
          setLoading(false);
          navigateTo('knowledge');
          setStatusMsg({ text: kb ? `Memory Overview: ${kb.stats.observationsUsed} obs, ${kb.stats.miniSkillsUsed} skills` : 'No memory overview available', type: 'info' });
          break;
        }
        case 'memory': {
          navigateTo('memory');
          setStatusMsg({ text: 'Memory — recent activity, search with /search <query>', type: 'info' });
          break;
        }
        case 'workbench': {
          navigateTo('workbench');
          setStatusMsg({ text: 'Workbench — session + context + chat', type: 'info' });
          break;
        }
        case 'graph': {
          navigateTo('graph');
          setStatusMsg({ text: 'Graph — knowledge graph browser', type: 'info' });
          break;
        }
        case 'help': case '?': {
          setOverlayView('commands');
          break;
        }
        case 'exit': case 'quit': case 'q': {
          exit();
          return;
        }
        default:
          setStatusMsg({ text: `Unknown command: /${cmd}. Type /help for available commands.`, type: 'error' });
      }
    } else {
      // Free text opens or continues the chat transcript.
      if (canSubmitChat) {
        await submitChatQuestion(raw);
      }
    }
  }, [project, exit, onExitForInteractive, submitChatQuestion, activeTab, overlayView, navigateTo, canSubmitChat]);

  // ── Action handlers (unchanged from original) ──────────────────
  const handleCleanupAction = useCallback(async (action: string) => {
    setActionStatus('Executing...');
    try {
      const { detectProject } = await import('../../project/detector.js');
      const { getProjectDataDir } = await import('../../store/persistence.js');
      const proj = detectProject(process.cwd());
      switch (action) {
        case '1': {
          if (!proj) { setActionStatus('No project detected.'); return; }
          try {
            const { resolveHooksDir } = await import('../../git/hooks-path.js');
            const { existsSync, readFileSync, writeFileSync, unlinkSync } = await import('node:fs');
            const resolved = resolveHooksDir(proj.rootPath);
            const hookMarker = '# [memorix-git-hook]';
            if (!resolved || !existsSync(resolved.hookPath)) { setActionStatus('No post-commit hook found.'); return; }
            const content = readFileSync(resolved.hookPath, 'utf-8');
            if (!content.includes(hookMarker)) { setActionStatus('No memorix hook installed.'); return; }
            const filtered: string[] = [];
            let inBlock = false;
            for (const line of content.split('\n')) {
              if (line.includes(hookMarker)) { inBlock = true; continue; }
              if (inBlock) {
                if (line.trim() === '' || line.startsWith('#!') || line.startsWith('# [')) {
                  if (line.trim() !== '') filtered.push(line);
                  inBlock = false;
                }
                continue;
              }
              filtered.push(line);
            }
            const remaining = filtered.join('\n').trim();
            if (!remaining || remaining === '#!/bin/sh') unlinkSync(resolved.hookPath);
            else writeFileSync(resolved.hookPath, `${remaining}\n`, 'utf-8');
            setActionStatus('Project artifacts uninstalled.');
          } catch (err) { setActionStatus(`Uninstall failed: ${err instanceof Error ? err.message : String(err)}`); }
          break;
        }
        case '2': {
          if (!proj) { setActionStatus('No project detected.'); return; }
          const dataDir = await getProjectDataDir(proj.id);
          try {
            const { initObservationStore, getObservationStore } = await import('../../store/obs-store.js');
            await initObservationStore(dataDir);
            const store = getObservationStore();
            const allObs = await store.loadAll() as any[];
            const toRemove = allObs.filter((o: any) => o.projectId === proj.id);
            if (toRemove.length > 0) { await store.bulkRemoveByIds(toRemove.map((o: any) => o.id)); setActionStatus(`Purged memory for ${proj.name}.`); }
            else { setActionStatus('No observations found for this project.'); }
          } catch { setActionStatus('Failed to purge — store unavailable.'); }
          break;
        }
        case '3': {
          const dataDir = await getProjectDataDir('_');
          try {
            const { initObservationStore, getObservationStore } = await import('../../store/obs-store.js');
            await initObservationStore(dataDir);
            await getObservationStore().bulkReplace([]);
            setActionStatus('All memory purged.');
          } catch { setActionStatus('Failed to purge — store unavailable.'); }
          break;
        }
        default: setActionStatus('');
      }
      await refreshSummary();
    } catch (err) { setActionStatus(`Error: ${err instanceof Error ? err.message : String(err)}`); }
  }, [refreshSummary]);

  const handleIngestAction = useCallback(async (action: string) => {
    setActionStatus('Executing...');
    try {
      const cwd = (await getProjectRoot()) ?? process.cwd();
      const { detectProject } = await import('../../project/detector.js');
      const projectInfo = detectProject(cwd);
      if (!projectInfo) { setActionStatus('No git repository detected.'); return; }
      switch (action) {
        case '1': {
          const { getRecentCommits, ingestCommit } = await import('../../git/extractor.js');
          const { shouldFilterCommit } = await import('../../git/noise-filter.js');
          const { getGitConfig } = await import('../../config.js');
          const { getProjectDataDir } = await import('../../store/persistence.js');
          const { initObservations, storeObservation } = await import('../../memory/observations.js');
          const { initObservationStore, getObservationStore: getStore } = await import('../../store/obs-store.js');
          const commits = getRecentCommits(cwd, 1);
          if (commits.length === 0) { setActionStatus('No commits found.'); break; }
          const commit = commits[0];
          const gitCfg = getGitConfig();
          const filterResult = shouldFilterCommit(commit, { skipMergeCommits: gitCfg.skipMergeCommits, excludePatterns: gitCfg.excludePatterns, noiseKeywords: gitCfg.noiseKeywords });
          if (filterResult.skip) { setActionStatus(`Skipped ${commit.shortHash}: ${filterResult.reason}`); break; }
          const dataDir = await getProjectDataDir(projectInfo.id);
          await initObservationStore(dataDir);
          await initObservations(dataDir);
          const existingObs = await getStore().loadAll() as Array<{ commitHash?: string }>;
          if (existingObs.some((o) => o.commitHash === commit.hash)) { setActionStatus(`Commit ${commit.shortHash} already ingested.`); break; }
          const result = ingestCommit(commit);
          await storeObservation({ entityName: result.entityName, type: result.type as any, title: result.title, narrative: result.narrative, facts: result.facts, concepts: result.concepts, filesModified: result.filesModified, projectId: projectInfo.id, source: 'git', commitHash: commit.hash });
          setActionStatus(`Ingested ${commit.shortHash}: ${commit.subject.slice(0, 48)}`);
          break;
        }
        case '2': {
          const { getRecentCommits, ingestCommit } = await import('../../git/extractor.js');
          const { filterCommits } = await import('../../git/noise-filter.js');
          const { getGitConfig } = await import('../../config.js');
          const { getProjectDataDir } = await import('../../store/persistence.js');
          const { initObservations, storeObservation } = await import('../../memory/observations.js');
          const { initObservationStore, getObservationStore: getStore } = await import('../../store/obs-store.js');
          const commits = getRecentCommits(cwd, 20);
          if (commits.length === 0) { setActionStatus('No commits found.'); break; }
          const gitCfg = getGitConfig();
          const { kept } = filterCommits(commits, { skipMergeCommits: gitCfg.skipMergeCommits, excludePatterns: gitCfg.excludePatterns, noiseKeywords: gitCfg.noiseKeywords });
          const dataDir = await getProjectDataDir(projectInfo.id);
          await initObservationStore(dataDir);
          await initObservations(dataDir);
          const existingObs = await getStore().loadAll() as Array<{ commitHash?: string }>;
          const existingHashes = new Set(existingObs.map((o) => o.commitHash).filter(Boolean));
          let ingested = 0, skipped = 0;
          for (const c of kept) {
            if (existingHashes.has(c.hash)) { skipped++; continue; }
            const result = ingestCommit(c);
            await storeObservation({ entityName: result.entityName, type: result.type as any, title: result.title, narrative: result.narrative, facts: result.facts, concepts: result.concepts, filesModified: result.filesModified, projectId: projectInfo.id, source: 'git', commitHash: c.hash });
            ingested++; existingHashes.add(c.hash);
          }
          setActionStatus(`Ingested ${ingested}/${kept.length} commits${skipped ? ` (${skipped} already stored)` : ''}.`);
          break;
        }
        case '3': {
          const { existsSync, readFileSync, writeFileSync, chmodSync } = await import('node:fs');
          const { ensureHooksDir } = await import('../../git/hooks-path.js');
          const hookMarker = '# [memorix-git-hook]';
          const resolved = ensureHooksDir(cwd);
          if (!resolved) { setActionStatus('No .git found.'); break; }
          const hookScript = `${hookMarker}\n# Memorix: Auto-ingest git commits as memories\nif command -v memorix >/dev/null 2>&1; then\n  memorix ingest commit --auto >/dev/null 2>&1 &\nfi\n`;
          if (existsSync(resolved.hookPath)) {
            if (readFileSync(resolved.hookPath, 'utf-8').includes(hookMarker)) { setActionStatus('Post-commit hook already installed.'); break; }
            writeFileSync(resolved.hookPath, `${readFileSync(resolved.hookPath, 'utf-8').trimEnd()}\n\n${hookScript}`, 'utf-8');
          } else { writeFileSync(resolved.hookPath, `#!/bin/sh\n${hookScript}`, 'utf-8'); }
          try { chmodSync(resolved.hookPath, 0o755); } catch { /* Windows */ }
          setActionStatus('Post-commit hook installed.');
          break;
        }
        case '4': {
          const { existsSync, readFileSync, writeFileSync, unlinkSync } = await import('node:fs');
          const { resolveHooksDir } = await import('../../git/hooks-path.js');
          const hookMarker = '# [memorix-git-hook]';
          const resolved = resolveHooksDir(cwd);
          if (!resolved || !existsSync(resolved.hookPath)) { setActionStatus('No post-commit hook found.'); break; }
          const content = readFileSync(resolved.hookPath, 'utf-8');
          if (!content.includes(hookMarker)) { setActionStatus('No memorix hook installed.'); break; }
          const filtered: string[] = [];
          let inBlock = false;
          for (const line of content.split('\n')) {
            if (line.includes(hookMarker)) { inBlock = true; continue; }
            if (inBlock) {
              if (line.trim() === '' || line.startsWith('#!') || line.startsWith('# [')) { if (line.trim() !== '') filtered.push(line); inBlock = false; }
              continue;
            }
            filtered.push(line);
          }
          const remaining = filtered.join('\n').trim();
          if (!remaining || remaining === '#!/bin/sh') unlinkSync(resolved.hookPath);
          else writeFileSync(resolved.hookPath, `${remaining}\n`, 'utf-8');
          setActionStatus('Post-commit hook uninstalled.');
          break;
        }
        default: setActionStatus('');
      }
      await refreshSummary();
    } catch (err) { setActionStatus(`Error: ${err instanceof Error ? err.message : String(err)}`); }
  }, [getProjectRoot, refreshSummary]);

  const handleIntegrateAction = useCallback(async (action: string) => {
    const agentKeyMap: Record<string, string> = { '1': 'claude', '2': 'windsurf', '3': 'cursor', '4': 'copilot', '5': 'kiro', '6': 'codex', '7': 'antigravity', '8': 'opencode', '9': 'trae', '0': 'gemini-cli' };
    const agent = agentKeyMap[action];
    if (!agent) { setActionStatus(''); return; }
    setActionStatus('Executing...');
    try {
      const cwd = (await getProjectRoot()) ?? process.cwd();
      const { installHooks } = await import('../../hooks/installers/index.js');
      const result = await installHooks(agent as import('../../hooks/types.js').AgentName, cwd, false);
      setActionStatus(`Installed ${agent} integration -> ${result.configPath}`);
    } catch (err) { setActionStatus(`Install failed: ${err instanceof Error ? err.message : String(err)}`); }
  }, [getProjectRoot]);

  const handleBackgroundAction = useCallback(async (action: string) => {
    setStatusMsg(null);
    try {
      const { execSync } = await import('node:child_process');
      if (background.running) {
        switch (action) {
          case 'w': if (background.dashboard) {
            try { execSync(`start "" "${background.dashboard}"`, { stdio: 'pipe' }); } catch {
              try { execSync(`open "${background.dashboard}"`, { stdio: 'pipe' }); } catch {
                try { execSync(`xdg-open "${background.dashboard}"`, { stdio: 'pipe' }); } catch { /* */ }
              }
            }
            setStatusMsg({ text: `Opening ${background.dashboard}`, type: 'success' });
          } break;
          case '1': try { execSync('memorix background restart', { stdio: 'pipe', timeout: 15000 }); setStatusMsg({ text: 'Restarted.', type: 'success' }); } catch (e) { setStatusMsg({ text: `Restart failed: ${e}`, type: 'error' }); } break;
          case '2': try { execSync('memorix background stop', { stdio: 'pipe', timeout: 10000 }); setStatusMsg({ text: 'Stopped.', type: 'success' }); } catch (e) { setStatusMsg({ text: `Stop failed: ${e}`, type: 'error' }); } break;
          case '3': setStatusMsg({ text: 'Run: memorix background logs (separate terminal)', type: 'info' }); break;
        }
      } else {
        switch (action) {
          case '1': try { execSync('memorix background start', { stdio: 'pipe', timeout: 15000 }); setStatusMsg({ text: 'Started.', type: 'success' }); } catch (e) { setStatusMsg({ text: `Start failed: ${e}`, type: 'error' }); } break;
          case '2': setStatusMsg({ text: 'Run: memorix dashboard (separate terminal)', type: 'info' }); break;
        }
      }
      setBackground(await getBackgroundStatus());
    } catch (err) { setStatusMsg({ text: `Error: ${err instanceof Error ? err.message : String(err)}`, type: 'error' }); }
  }, [background]);

  const handleDashboardAction = useCallback(async (action: string) => {
    setStatusMsg(null);
    try {
      const { execSync } = await import('node:child_process');
      if (background.healthy && background.dashboard) {
        if (action === '1') {
          try { execSync(`start "" "${background.dashboard}"`, { stdio: 'pipe' }); } catch {
            try { execSync(`open "${background.dashboard}"`, { stdio: 'pipe' }); } catch {
              try { execSync(`xdg-open "${background.dashboard}"`, { stdio: 'pipe' }); } catch { /* */ }
            }
          }
          setStatusMsg({ text: `Opening ${background.dashboard}`, type: 'success' });
        } else if (action === '2') { setStatusMsg({ text: 'Run: memorix dashboard (separate terminal)', type: 'info' }); }
      } else {
        if (action === '1') { try { execSync('memorix background start', { stdio: 'pipe', timeout: 15000 }); setStatusMsg({ text: 'Started.', type: 'success' }); setBackground(await getBackgroundStatus()); } catch (e) { setStatusMsg({ text: `Start failed: ${e}`, type: 'error' }); } }
        else if (action === '2') { setStatusMsg({ text: 'Run: memorix dashboard (separate terminal)', type: 'info' }); }
      }
    } catch (err) { setStatusMsg({ text: `Error: ${err instanceof Error ? err.message : String(err)}`, type: 'error' }); }
  }, [background]);

  // ── Render tab content ────────────────────────────────────────
  const renderTabContent = () => {
    switch (activeTab) {
      case 'home':
        return <HomeView project={project} health={health} background={background} contentWidth={contentWidth} />;
      case 'knowledge': {
        const itemCount = knowledge ? knowledge.sections.reduce((sum, s) => sum + s.items.length, 0) : 0;
        return <KnowledgeView knowledge={knowledge} loading={loading && !knowledge} selectedItemIdx={knowledgeSelectedIdx} itemCount={itemCount} />;
      }
      case 'memory':
        return (
          <MemoryView
            projectId={project?.id}
            focusRefId={focusRef?.refId}
            selectedIdx={memorySelectedIdx}
            inputFocused={inputFocused}
            onNavigateKnowledge={(target) => {
              (async () => {
                const kb = await getKnowledgeBase(project?.id);
                setKnowledge(kb);
                // Find matching knowledge item by ref
                if (kb && target.refIds.length > 0) {
                  let foundIdx = -1;
                  let gi = 0;
                  for (const section of kb.sections) {
                    for (const ki of section.items) {
                      if (ki.refs.some(r => target.refIds.includes(r.id))) { foundIdx = gi; break; }
                      gi++;
                    }
                    if (foundIdx >= 0) break;
                  }
                  setKnowledgeSelectedIdx(foundIdx >= 0 ? foundIdx : 0);
                }
                navigateTo('knowledge');
              })();
            }}
          />
        );
      case 'workbench':
        return <WorkbenchView project={project} contentWidth={contentWidth} viewportHeight={mainAreaHeight} inputFocused={inputFocused} />;
      case 'graph':
        return (
          <GraphView
            projectId={project?.id}
            inputFocused={inputFocused}
            onNavigateKnowledge={(target) => {
              (async () => {
                const kb = await getKnowledgeBase(project?.id);
                setKnowledge(kb);
                if (kb && target.refIds.length > 0) {
                  let foundIdx = -1;
                  let gi = 0;
                  for (const section of kb.sections) {
                    for (const ki of section.items) {
                      if (ki.refs.some(r => target.refIds.includes(r.id))) { foundIdx = gi; break; }
                      gi++;
                    }
                    if (foundIdx >= 0) break;
                  }
                  setKnowledgeSelectedIdx(foundIdx >= 0 ? foundIdx : 0);
                }
                navigateTo('knowledge');
              })();
            }}
          />
        );
      default:
        return null;
    }
  };

  // ── Render overlay content ─────────────────────────────────────
  const renderOverlayContent = () => {
    if (!overlayView) return null;
    const fitInline = (text: string, max: number): string => {
      if (max <= 0) return '';
      if (text.length <= max) return text;
      if (max === 1) return '.';
      return `${text.slice(0, max - 1)}.`;
    };
    switch (overlayView) {
      case 'chat':
        return <ChatView ref={chatViewRef} project={project} messages={chatMessages} loading={loading} contentWidth={contentWidth} viewportHeight={mainAreaHeight} threadId={chatThreadId} keyboardScrollEnabled={!inputFocused} />;
      case 'search':
        return <SearchResultsView results={searchResults} query={searchQuery} loading={loading} />;
      case 'doctor':
        return <DoctorView doctor={doctor} loading={loading} />;
      case 'project':
        return <ProjectView project={project} />;
      case 'background':
        return <BackgroundView background={background} loading={loading} />;
      case 'dashboard':
        return <DashboardView background={background} />;
      case 'recent':
        return <RecentView recentMemories={recentMemories} loading={loading} />;
      case 'cleanup':
        return <CleanupView onAction={handleCleanupAction} statusText={actionStatus} />;
      case 'ingest':
        return <IngestView onAction={handleIngestAction} statusText={actionStatus} />;
      case 'integrate':
        return <IntegrateView statusText={actionStatus} />;
      case 'configure':
        return <ConfigureView onBack={() => setOverlayView(null)} />;
      case 'wiki':
        return <WikiView knowledge={knowledge} loading={loading} />;
      case 'commands':
        return (
          <Box flexDirection="column" paddingX={2} paddingY={1}>
            <Text color={COLORS.brand} bold>Commands</Text>
            <Text color={COLORS.border}>{'-'.repeat(Math.min(50, contentWidth - 8))}</Text>
            <Box marginTop={1} flexDirection="column">
              {SLASH_COMMANDS.map((command) => {
                const desc = `${command.description}${command.alias ? ` (${command.alias})` : ''}`;
                return (
                  <Box key={command.name}>
                    <Text color={COLORS.brand}>{fitInline(command.name.padEnd(16), 16)}</Text>
                    <Text color={COLORS.text}>{fitInline(desc, Math.max(18, contentWidth - 22))}</Text>
                  </Box>
                );
              })}
            </Box>
            <Box marginTop={1}><Text color={COLORS.textDim}>Esc to return</Text></Box>
          </Box>
        );
      default:
        return null;
    }
  };

  // ── Layout ─────────────────────────────────────────────────────
  const termWidth = stdout?.columns || 80;
  const termHeight = stdout?.rows || 24;
  const { sidebarWidth, contentWidth, narrow, veryNarrow } = computeLayoutWidths(termWidth);
  const statusRows = statusMsg ? getStatusMessageRows(statusMsg.text) : 0;
  const reservedRows = 3 + statusRows + (COMMAND_BAR_ROWS + 1); // +1 for TabBar
  const mainAreaHeight = Math.max(6, termHeight - reservedRows);
  const paletteHeight = getCommandPaletteHeight(paletteItems.length);
  const paletteTopInContent = Math.max(0, mainAreaHeight - paletteHeight);
  const paletteSeparatorWidth = Math.max(8, Math.min(30, contentWidth - 10));

  return (
    <Box flexDirection="column" height={termHeight}>
      <HeaderBar version={version} project={project} health={health} mode={mode} />

      {/* Tab bar */}
      <Box flexShrink={0} paddingX={1}>
        <TabBar activeTab={activeTab} contentWidth={contentWidth} />
      </Box>

      {/* Main area */}
      <Box flexDirection={narrow ? 'column' : 'row'} height={mainAreaHeight} flexGrow={0} flexShrink={1}>
        <Box flexGrow={1} flexShrink={1} flexDirection="column" paddingRight={narrow ? 0 : 1}>
          {overlayView ? renderOverlayContent() : renderTabContent()}

          {/* Command palette overlay */}
          {paletteVisible && paletteItems.length > 0 && (() => {
            const contentColW = termWidth - (narrow ? 0 : sidebarWidth) - (narrow ? 0 : 1);
            const palBoxW = Math.max(40, contentColW);
            const palInner = palBoxW - 4;
            const padText = (s: string) => s.length >= palInner ? s.slice(0, palInner) : s + ' '.repeat(palInner - s.length);
            const row = (content: string, fg: string, bold = false) => (
              <Text key={content.slice(0, 20)} color={fg} bold={bold}>
                <Text color={COLORS.border}>{'| '}</Text>{padText(content)}<Text color={COLORS.border}>{' |'}</Text>
              </Text>
            );
            const hBorder = '-'.repeat(palBoxW - 2);
            return (
              <Box position="absolute" flexDirection="column" width={palBoxW} marginTop={paletteTopInContent}>
                <Text color={COLORS.border}>{'+' + hBorder + '+'}</Text>
                {row('Commands', COLORS.brand, true)}
                {row('-'.repeat(Math.min(palInner, paletteSeparatorWidth)), COLORS.border)}
                {paletteItems.map((cmd, index) => {
                  const prefix = index === paletteSelectedIdx ? '> ' : '  ';
                  const name = cmd.name.padEnd(16).slice(0, 16);
                  const desc = cmd.description + (cmd.alias ? ` (${cmd.alias})` : '');
                  return (
                    <Text key={cmd.name} color={index === paletteSelectedIdx ? COLORS.brand : COLORS.text} bold={index === paletteSelectedIdx}>
                      <Text color={COLORS.border}>{'| '}</Text>{padText(prefix + name + desc)}<Text color={COLORS.border}>{' |'}</Text>
                    </Text>
                  );
                })}
                {row('up/down navigate | Tab complete | Enter execute', COLORS.muted)}
                <Text color={COLORS.border}>{'+' + hBorder + '+'}</Text>
              </Box>
            );
          })()}
        </Box>

        {/* Context rail */}
        {!narrow ? (
          <ContextRail
            project={project}
            health={health}
            background={background}
            activeView={(overlayView ?? activeTab) as ViewType}
            lastChat={lastChat}
            transcriptCount={chatMessages.length}
            width={sidebarWidth}
          />
        ) : !veryNarrow ? (
          <Box flexDirection="column" width={24} flexShrink={0} paddingLeft={1} borderStyle="single" borderColor={COLORS.border} borderLeft={true} borderTop={false} borderRight={false} borderBottom={false}>
            <Text color={COLORS.brand} bold wrap="truncate-end">Context</Text>
            <Box><Text color={COLORS.muted} wrap="truncate-end">Tab  </Text><Text color={COLORS.text} wrap="truncate-end">{activeTab}</Text></Box>
            <Box><Text color={COLORS.muted} wrap="truncate-end">Mem  </Text><Text color={COLORS.text} wrap="truncate-end">{health.activeMemories}</Text></Box>
            <Box><Text color={COLORS.muted} wrap="truncate-end">Mode </Text><Text color={health.embeddingProvider === 'ready' ? COLORS.success : COLORS.muted} wrap="truncate-end">{health.searchModeLabel}</Text></Box>
            <Box><Text color={COLORS.muted} wrap="truncate-end">Msgs </Text><Text color={COLORS.text} wrap="truncate-end">{chatMessages.length}</Text></Box>
            <Box marginTop={1}><Text color={COLORS.textDim} wrap="truncate-end">Alt+1..5 tabs</Text></Box>
          </Box>
        ) : null}
      </Box>

      {/* Status message */}
      {statusMsg && (
        <Box flexShrink={0}>
          <StatusMessage message={statusMsg.text} type={statusMsg.type} />
        </Box>
      )}

      {/* Command bar */}
      <Box flexShrink={0}>
        <CommandBar
          onSubmit={handleCommand}
          onExit={() => exit()}
          disabled={commandBarDisabled}
          onFocusChange={setInputFocused}
          prefixLabel={activeTab === 'workbench' ? '[ask]' : '[cmd]'}
          placeholder={activeTab === 'workbench' ? 'ask Memorix about this project or use /command' : 'type a question or /command'}
          contentWidth={contentWidth}
          onPaletteChange={setPaletteVisible}
          onPaletteItems={handlePaletteItemsChange}
          disabledHint={commandBarDisabled && overlayView ? `${overlayView}: use keys shown, Esc to back` : undefined}
          blockedFirstChars={activeTab === 'graph' ? ['f', 'k'] : activeTab === 'memory' ? ['k'] : activeTab === 'knowledge' ? ['m'] : undefined}
        />
      </Box>
    </Box>
  );
}

// ── Helpers ──────────────────────────────────────────────────────
function findFlatKnowledgeItem(knowledge: import('../../wiki/types.js').ProjectKnowledgeOverview, targetIdx: number) {
  let gi = 0;
  for (const section of knowledge.sections) {
    for (const item of section.items) {
      if (gi === targetIdx) return item;
      gi++;
    }
  }
  return null;
}
