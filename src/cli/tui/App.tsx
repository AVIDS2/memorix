/**
 * WorkbenchApp — Main Ink application for Memorix TUI
 *
 * Three-panel layout: HeaderBar + (MainContent | Sidebar) + CommandBar
 * Manages global state, view routing, and command execution.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useStdout, useInput } from 'ink';
import { COLORS, SLASH_COMMANDS, COMMAND_BAR_ROWS, computeLayoutWidths, getCommandPaletteHeight, getHomeSeparatorWidth, getStatusMessageRows } from './theme.js';
import type { ViewType } from './theme.js';
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
  StatusMessage,
} from './Panels.js';
import { ConfigureView } from './ConfigureView.js';
import { NAV_KEY_MAP, ACTION_VIEWS, ESC_RETURNABLE_VIEWS, resolveGlobalNav } from './useNavigation.js';
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
  detectMode,
} from './data.js';
import { ChatView } from './ChatView.js';
import type { ChatTranscriptMessage, ChatViewRef } from './ChatView.js';
import { ContextRail } from './ContextRail.js';
import { askMemoryQuestion, askMemoryQuestionStream } from './chat-service.js';
import type { ChatAnswer, StreamingChatCallbacks } from './chat-service.js';

interface AppProps {
  version: string;
  onExitForInteractive: (cmd: string) => void;
}

function createThreadId(): string {
  return `t${Date.now().toString(36)}`;
}

function getNewChatHint(hasSavedThread: boolean): string {
  return hasSavedThread
    ? 'New chat ready — type a question or use /resume to continue a saved thread'
    : 'New chat ready — type a question to start';
}

export function WorkbenchApp({ version, onExitForInteractive }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();

  // ── Constants ───────────────────────────────────────────────
  // Cap in-memory chat transcript to avoid unbounded memory growth.
  // Older messages remain persisted in SQLite; only the tail is kept in RAM.
  const MAX_CHAT_MESSAGES = 100;

  // ── State ──────────────────────────────────────────────────
  const [view, setView] = useState<ViewType>('home');
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [health, setHealth] = useState<HealthInfo>({
    embeddingProvider: 'disabled',
    embeddingProviderName: undefined,
    embeddingLabel: 'Disabled',
    searchMode: 'fulltext',
    searchModeLabel: 'BM25 full-text',
    searchDiagnostic: '',
    backfillPending: 0,
    totalMemories: 0,
    activeMemories: 0,
    sessions: 0,
  });
  const [background, setBackground] = useState<BackgroundInfo>({ running: false, healthy: false });
  const [recentMemories, setRecentMemories] = useState<MemoryItem[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [doctor, setDoctor] = useState<DoctorResult | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [mode, setMode] = useState('CLI');
  const [actionStatus, setActionStatus] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatTranscriptMessage[]>([]);
  const [chatThreadId, setChatThreadId] = useState<string>(() => createThreadId());
  const [lastChat, setLastChat] = useState<ChatAnswer | null>(null);
  // Derived from centralized navigation model
  const isActionView = ACTION_VIEWS.has(view);
  const canEscReturnHome = ESC_RETURNABLE_VIEWS.has(view);
  // Track whether CommandBar is actively receiving text input
  const [inputFocused, setInputFocused] = useState(false);
  // Track whether command palette is visible (for layout compensation)
  const [paletteVisible, setPaletteVisible] = useState(false);
  // Track palette items for overlay rendering
  const [paletteItems, setPaletteItems] = useState<PaletteItem[]>([]);
  const [paletteSelectedIdx, setPaletteSelectedIdx] = useState(0);
  // Ref to ChatView for keyboard scroll (PageUp/PageDown/arrows)
  const chatViewRef = useRef<ChatViewRef>(null);
  // AbortController for cancelling ongoing LLM chat requests
  const chatAbortRef = useRef<AbortController | null>(null);

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

  // ── Unified 3-layer key dispatch ──────────────────────────────
  // Layer 1: Action view local keys (highest priority)
  // Layer 2: CommandBar input mode (captures printable chars)
  // Layer 3: Global nav keys (lowest, only when idle)
  useInput((ch, key) => {
    // Esc while LLM is thinking: cancel the ongoing chat request
    if (key.escape && loading && view === 'chat' && chatAbortRef.current) {
      cancelChat();
      return;
    }

    // Esc: return home from any secondary view
    if (key.escape && canEscReturnHome) {
      handleCommand('/home');
      return;
    }

    // Layer 1: Action view local keys
    if (isActionView) {
      if (view === 'cleanup' && /^[1-3]$/.test(ch)) { handleCleanupAction(ch); return; }
      if (view === 'ingest' && /^[1-4]$/.test(ch)) { handleIngestAction(ch); return; }
      if (view === 'integrate' && /^[0-9]$/.test(ch)) { handleIntegrateAction(ch); return; }
      if (view === 'background' && /^[1-3]$/.test(ch)) { handleBackgroundAction(ch); return; }
      if (view === 'background' && ch === 'w' && background.dashboard) { handleBackgroundAction('w'); return; }
      if (view === 'dashboard' && /^[1-2]$/.test(ch)) { handleDashboardAction(ch); return; }
      // 'h' in action views = home
      if (ch === 'h') { handleCommand('/home'); return; }
      // Configure view handles its own keys internally via useInput
      return;
    }

    // Layer 2: CommandBar has input — don't intercept printable chars
    if (inputFocused) return;

    // Layer 3: Global navigation keys — handled by Sidebar via useInput
    // Sidebar owns shortcut key → onAction dispatch when isFocused=true
  });

  // ── Initial data load ──────────────────────────────────────
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
        setStatusMsg({ text: getNewChatHint(false), type: 'info' });

        if (proj) {
          try {
            const { getProjectDataDir } = await import('../../store/persistence.js');
            const { getChatStore } = await import('../../store/chat-store.js');
            const dataDir = await getProjectDataDir(proj.id);
            const store = getChatStore();
            await store.init(dataDir);
            const latestThreadId = store.getLatestThreadId(proj.id);
            setStatusMsg({ text: getNewChatHint(Boolean(latestThreadId)), type: 'info' });
          } catch (err) { process.stderr.write(`[memorix] chat restore failed: ${err instanceof Error ? err.message : String(err)}\n`); }
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const CHAT_GLOBAL_TIMEOUT_MS = 90_000; // 90s hard cap for entire chat operation

  const cancelChat = useCallback(() => {
    if (chatAbortRef.current) {
      chatAbortRef.current.abort('User cancelled');
      chatAbortRef.current = null;
    }
  }, []);

  const submitChatQuestion = useCallback(async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    // Cancel any in-flight chat request before starting a new one
    cancelChat();

    const ac = new AbortController();
    chatAbortRef.current = ac;
    // Hard timeout for the whole operation — kills even stuck network sockets
    const globalTimer = setTimeout(() => ac.abort('Chat timed out'), CHAT_GLOBAL_TIMEOUT_MS);

    const userMessage: ChatTranscriptMessage = {
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    const history = chatMessages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    setView('chat');
    setLoading(true);
    setChatMessages((prev) => {
      const next = [...prev, userMessage];
      return next.length > MAX_CHAT_MESSAGES ? next.slice(-MAX_CHAT_MESSAGES) : next;
    });

    // Persist user message to SQLite
    try {
      if (project) {
        const { getProjectDataDir } = await import('../../store/persistence.js');
        const { getChatStore } = await import('../../store/chat-store.js');
        const dataDir = await getProjectDataDir(project.id);
        const store = getChatStore();
        await store.init(dataDir);
        store.append(project.id, chatThreadId, userMessage);
      }
    } catch (err) { process.stderr.write(`[memorix] chat persist user msg failed: ${err instanceof Error ? err.message : String(err)}\n`); }

    // Add a placeholder assistant message for streaming updates
    const streamingMsg: ChatTranscriptMessage = {
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      meta: { usedLLM: true },
    };
    setChatMessages((prev) => {
      const next = [...prev, streamingMsg];
      return next.length > MAX_CHAT_MESSAGES ? next.slice(-MAX_CHAT_MESSAGES) : next;
    });

    try {
      const result = await askMemoryQuestionStream(trimmed, history, {
        onChunk: (text) => {
          // Incrementally update the last assistant message
          setChatMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              updated[lastIdx] = {
                ...updated[lastIdx],
                content: updated[lastIdx].content + text,
              };
            }
            return updated;
          });
        },
        onToolCall: (name) => {
          // Show tool execution progress to the user
          setChatMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              updated[lastIdx] = {
                ...updated[lastIdx],
                content: `Searching memories (${name})…`,
              };
            }
            return updated;
          });
        },
      }, ac.signal);

      // Final update with complete metadata
      const assistantMessage: ChatTranscriptMessage = {
        role: 'assistant',
        content: result.answer,
        sources: result.sources,
        timestamp: new Date().toISOString(),
        error: false,
        meta: {
          usedLLM: result.usedLLM,
          searchMode: result.searchMode,
          llmModel: result.llmModel,
          warning: result.warning,
        },
      };
      setLastChat(result);
      setChatMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
          updated[lastIdx] = assistantMessage;
        }
        return updated;
      });
      setHealth(await getHealthInfo(project?.id));

      // Persist assistant message to SQLite
      try {
        if (project) {
          const { getProjectDataDir } = await import('../../store/persistence.js');
          const { getChatStore } = await import('../../store/chat-store.js');
          const dataDir = await getProjectDataDir(project.id);
          const store = getChatStore();
          await store.init(dataDir);
          store.append(project.id, chatThreadId, assistantMessage);
        }
      } catch (err2) { process.stderr.write(`[memorix] chat persist assistant msg failed: ${err2 instanceof Error ? err2.message : String(err2)}\n`); }
    } catch (err) {
      // Distinguish user cancellation from real errors
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      const isCancelled = isAbort || (err instanceof Error && err.message === 'User cancelled');
      const failure = isCancelled ? 'Chat cancelled (Esc)' : (err instanceof Error ? err.message : String(err));
      const errorMsg: ChatTranscriptMessage = {
        role: 'assistant',
        content: isCancelled ? 'Chat cancelled.' : `Chat failed: ${failure}`,
        error: !isCancelled,
        timestamp: new Date().toISOString(),
      };
      setChatMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
          updated[lastIdx] = errorMsg;
        }
        return updated;
      });
      if (!isCancelled) {
        setStatusMsg({ text: `Chat failed: ${failure}`, type: 'error' });
      }
    } finally {
      clearTimeout(globalTimer);
      chatAbortRef.current = null;
      setLoading(false);
    }
  }, [chatMessages, project, cancelChat]);

  // ── Command handler ────────────────────────────────────────
  const handleCommand = useCallback(async (input: string) => {
    const raw = input.trim();
    if (!raw) return;

    // Clear status
    setStatusMsg(null);

    if (raw.startsWith('/')) {
      const parts = raw.slice(1).split(/\s+/);
      const cmd = parts[0]?.toLowerCase() || '';
      const arg = parts.slice(1).join(' ');

      switch (cmd) {
        case 'chat':
        case 'ask': {
          if (!arg) {
            setView('chat');
            setStatusMsg({ text: 'Chat ready — type a question. Use /new for a fresh thread or /resume to open a saved one', type: 'info' });
            return;
          }
          await submitChatQuestion(arg);
          break;
        }

        case 'clear':
        case 'cc': {
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
          setView('chat');
          setStatusMsg({ text: 'Chat cleared', type: 'info' });
          break;
        }

        case 'resume':
        case 'cr': {
          if (!project) {
            setStatusMsg({ text: 'No project detected', type: 'error' });
            break;
          }
          try {
            const { getProjectDataDir } = await import('../../store/persistence.js');
            const { getChatStore } = await import('../../store/chat-store.js');
            const dataDir = await getProjectDataDir(project.id);
            const store = getChatStore();
            await store.init(dataDir);
            const threads = store.listThreads(project.id);

            if (threads.length === 0) {
              // No threads in DB — check if current in-memory messages exist
              if (chatMessages.length > 0) {
                setView('chat');
                setStatusMsg({ text: `Current thread has ${chatMessages.length} messages (not yet persisted)`, type: 'info' });
              } else {
                setStatusMsg({ text: 'No saved threads found. Start chatting with /chat or type a question.', type: 'info' });
              }
              break;
            }

            // If arg provided (e.g. /resume t1a2b3c or /resume 2), load that specific thread
            if (arg) {
              // Support numeric index (1-based) as shortcut: /resume 2 → threads[1]
              const numericIdx = /^\d+$/.test(arg) ? parseInt(arg, 10) - 1 : -1;
              const target = numericIdx >= 0 && numericIdx < threads.length
                ? threads[numericIdx]
                : threads.find(t => t.threadId === arg);
              if (target) {
                const saved = store.load(project.id, target.threadId);
                setChatThreadId(target.threadId);
                setChatMessages(saved);
                setView('chat');
                setStatusMsg({ text: `Resumed thread ${target.threadId} (${saved.length} messages)`, type: 'success' });
              } else {
                const threadList = threads.map((t: any, i: number) =>
                  `${i + 1}. ${t.threadId} (${t.messageCount} msgs, ${t.lastActivity?.slice(0, 16) || '?'})`
                ).join('\n');
                setStatusMsg({ text: `Thread "${arg}" not found. Available:\n${threadList}`, type: 'error' });
              }
              break;
            }

            // No arg: load the most recent thread (first in list = most recent)
            const latestThread = threads[0];
            const saved = store.load(project.id, latestThread.threadId);
            setChatThreadId(latestThread.threadId);
            setChatMessages(saved);
            setView('chat');

            if (threads.length === 1) {
              setStatusMsg({ text: `Resumed thread ${latestThread.threadId} (${saved.length} messages)`, type: 'success' });
            } else {
              const threadList = threads.map((t: any, i: number) => {
                const marker = t.threadId === latestThread.threadId ? ' (active)' : '';
                return `${String(i + 1).padStart(2)}. ${t.threadId}  ${String(t.messageCount).padStart(3)} msgs  ${t.lastActivity?.slice(0, 16) || '?'}${marker}`;
              }).join('\n');
              setStatusMsg({ text: `Resumed ${latestThread.threadId} (${saved.length} msgs). Other threads:\n${threadList}\nUse /resume <threadId> to switch`, type: 'info' });
            }
          } catch (err) {
            setStatusMsg({ text: `Could not resume chat: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
          }
          break;
        }

        case 'new':
        case 'cn': {
          try {
            const { getChatStore } = await import('../../store/chat-store.js');
            const store = getChatStore();
            const newId = store.newThreadId();
            setChatThreadId(newId);
            setChatMessages([]);
            setView('chat');
            setStatusMsg({ text: `New thread ${newId} — type a question to start`, type: 'info' });
          } catch {
            // Fallback without store
            const newId = `t${Date.now().toString(36)}`;
            setChatMessages([]);
            setChatThreadId(newId);
            setView('chat');
            setStatusMsg({ text: `New thread ${newId} — type a question to start`, type: 'info' });
          }
          break;
        }

        case 'search':
        case 's': {
          const query = arg || '';
          if (!query) {
            setStatusMsg({ text: 'Usage: /search <query>', type: 'info' });
            return;
          }
          setView('search');
          setSearchQuery(query);
          setLoading(true);
          const results = await searchMemories(query);
          setSearchResults(results);
          setLoading(false);
          // Refresh health so Search Mode / diagnostic reflects actual search path
          setHealth(await getHealthInfo(project?.id));
          break;
        }

        case 'remember':
        case 'r': {
          if (!arg) {
            setStatusMsg({ text: 'Usage: /remember <text>', type: 'info' });
            return;
          }
          setLoading(true);
          const stored = await storeQuickMemory(arg);
          setLoading(false);
          if (stored) {
            setStatusMsg({ text: `Stored #${stored.id}: ${stored.title}`, type: 'success' });
            // Refresh recent
            const recent = await getRecentMemories(8, project?.id);
            setRecentMemories(recent);
            const h = await getHealthInfo(project?.id);
            setHealth(h);
          } else {
            setStatusMsg({ text: 'Failed to store memory', type: 'error' });
          }
          break;
        }

        case 'recent':
        case 'v': {
          setView('recent');
          setLoading(true);
          const recent = await getRecentMemories(12, project?.id);
          setRecentMemories(recent);
          setLoading(false);
          setStatusMsg({ text: `Showing ${recent.length} recent memories`, type: 'info' });
          break;
        }

        case 'home':
        case 'h': {
          setView('home');
          setStatusMsg({ text: 'Home — type a question or /command', type: 'info' });
          break;
        }

        case 'cleanup': {
          setView('cleanup');
          setActionStatus('');
          setStatusMsg({ text: 'Cleanup: choose 1/2/3', type: 'info' });
          break;
        }

        case 'ingest': {
          setView('ingest');
          setActionStatus('');
          setStatusMsg({ text: 'Ingest: choose 1/2/3/4', type: 'info' });
          break;
        }

        case 'doctor': {
          setView('doctor');
          setLoading(true);
          const d = await getDoctorSummary();
          setDoctor(d);
          setLoading(false);
          setStatusMsg({ text: 'Diagnostics complete', type: 'info' });
          break;
        }

        case 'project':
        case 'status': {
          setView('project');
          setStatusMsg({ text: project ? `Project: ${project.name}` : 'No project detected', type: 'info' });
          break;
        }

        case 'background':
        case 'bg': {
          setView('background');
          setLoading(true);
          const bg = await getBackgroundStatus();
          setBackground(bg);
          setLoading(false);
          setStatusMsg({ text: bg.running ? 'Background running' : 'Background stopped', type: 'info' });
          break;
        }

        case 'dashboard':
        case 'dash': {
          setView('dashboard');
          // Refresh background info for dashboard URL
          const bg = await getBackgroundStatus();
          setBackground(bg);
          setStatusMsg({ text: bg.healthy && bg.dashboard ? `Dashboard: ${bg.dashboard}` : 'Background not running — /background to start', type: 'info' });
          break;
        }

        case 'integrate':
        case 'setup': {
          setView('integrate');
          setActionStatus('');
          setStatusMsg({ text: 'Integrate: choose 0-9 for IDE', type: 'info' });
          break;
        }

        case 'configure':
        case 'config': {
          setView('configure');
          setStatusMsg({ text: 'Configure: Up/Down/Enter, Esc to back', type: 'info' });
          break;
        }

        case 'help':
        case '?': {
          setStatusMsg({
            text: SLASH_COMMANDS.map(c =>
              `${c.name.padEnd(16)} ${c.description}${c.alias ? ` (${c.alias})` : ''}`
            ).join('\n'),
            type: 'info',
          });
          break;
        }

        case 'exit':
        case 'quit':
        case 'q': {
          exit();
          return;
        }

        default:
          setStatusMsg({ text: `Unknown command: /${cmd}. Type /help for available commands.`, type: 'error' });
      }
    } else {
      await submitChatQuestion(raw);
    }
  }, [project, exit, onExitForInteractive, submitChatQuestion]);

  // ── Action handlers for Cleanup, Ingest, Background, Dashboard ──

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
            if (!resolved || !existsSync(resolved.hookPath)) {
              setActionStatus('No post-commit hook found.');
              return;
            }
            const content = readFileSync(resolved.hookPath, 'utf-8');
            if (!content.includes(hookMarker)) {
              setActionStatus('No memorix hook installed.');
              return;
            }
            const filtered: string[] = [];
            let inMemorixBlock = false;
            for (const line of content.split('\n')) {
              if (line.includes(hookMarker)) {
                inMemorixBlock = true;
                continue;
              }
              if (inMemorixBlock) {
                if (line.trim() === '' || line.startsWith('#!') || line.startsWith('# [')) {
                  if (line.trim() !== '') filtered.push(line);
                  inMemorixBlock = false;
                }
                continue;
              }
              filtered.push(line);
            }
            const remaining = filtered.join('\n').trim();
            if (!remaining || remaining === '#!/bin/sh') {
              unlinkSync(resolved.hookPath);
            } else {
              writeFileSync(resolved.hookPath, `${remaining}\n`, 'utf-8');
            }
            setActionStatus('Project artifacts uninstalled.');
          } catch (err) {
            setActionStatus(`Uninstall failed: ${err instanceof Error ? err.message : String(err)}`);
          }
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
            if (toRemove.length > 0) {
              await store.bulkRemoveByIds(toRemove.map((o: any) => o.id));
              setActionStatus(`Purged memory for ${proj.name}.`);
            } else { setActionStatus('No observations found for this project.'); }
          } catch { setActionStatus('Failed to purge — store unavailable.'); }
          break;
        }
        case '3': {
          const dataDir = await getProjectDataDir('_');
          try {
            const { initObservationStore, getObservationStore } = await import('../../store/obs-store.js');
            await initObservationStore(dataDir);
            const store = getObservationStore();
            await store.bulkReplace([]);
            setActionStatus('All memory purged.');
          } catch { setActionStatus('Failed to purge — store unavailable.'); }
          break;
        }
        default: setActionStatus('');
      }
      await refreshSummary();
    } catch (err) {
      setActionStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refreshSummary]);

  const handleIngestAction = useCallback(async (action: string) => {
    setActionStatus('Executing...');
    try {
      const cwd = (await getProjectRoot()) ?? process.cwd();
      const { detectProject } = await import('../../project/detector.js');
      const projectInfo = detectProject(cwd);
      if (!projectInfo) {
        setActionStatus('No git repository detected for the current project.');
        return;
      }
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
          const filterResult = shouldFilterCommit(commit, {
            skipMergeCommits: gitCfg.skipMergeCommits,
            excludePatterns: gitCfg.excludePatterns,
            noiseKeywords: gitCfg.noiseKeywords,
          });
          if (filterResult.skip) {
            setActionStatus(`Skipped ${commit.shortHash}: ${filterResult.reason}`);
            break;
          }
          const dataDir = await getProjectDataDir(projectInfo.id);
          await initObservationStore(dataDir);
          await initObservations(dataDir);
          const existingObs = await getStore().loadAll() as Array<{ commitHash?: string }>;
          if (existingObs.some((o) => o.commitHash === commit.hash)) {
            setActionStatus(`Commit ${commit.shortHash} already ingested.`);
            break;
          }
          const result = ingestCommit(commit);
          await storeObservation({
            entityName: result.entityName,
            type: result.type as any,
            title: result.title,
            narrative: result.narrative,
            facts: result.facts,
            concepts: result.concepts,
            filesModified: result.filesModified,
            projectId: projectInfo.id,
            source: 'git',
            commitHash: commit.hash,
          });
          setActionStatus(`Ingested ${commit.shortHash}: ${truncateTitle(commit.subject, 48)}`);
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
          const { kept } = filterCommits(commits, {
            skipMergeCommits: gitCfg.skipMergeCommits,
            excludePatterns: gitCfg.excludePatterns,
            noiseKeywords: gitCfg.noiseKeywords,
          });
          const dataDir = await getProjectDataDir(projectInfo.id);
          await initObservationStore(dataDir);
          await initObservations(dataDir);
          const existingObs = await getStore().loadAll() as Array<{ commitHash?: string }>;
          const existingHashes = new Set(existingObs.map((o) => o.commitHash).filter(Boolean));
          let ingested = 0;
          let skipped = 0;
          for (const c of kept) {
            if (existingHashes.has(c.hash)) {
              skipped++;
              continue;
            }
            const result = ingestCommit(c);
            await storeObservation({
              entityName: result.entityName,
              type: result.type as any,
              title: result.title,
              narrative: result.narrative,
              facts: result.facts,
              concepts: result.concepts,
              filesModified: result.filesModified,
              projectId: projectInfo.id,
              source: 'git',
              commitHash: c.hash,
            });
            ingested++;
            existingHashes.add(c.hash);
          }
          setActionStatus(`Ingested ${ingested}/${kept.length} commits${skipped ? ` (${skipped} already stored)` : ''}.`);
          break;
        }
        case '3': {
          const { existsSync, readFileSync, writeFileSync, chmodSync } = await import('node:fs');
          const { ensureHooksDir } = await import('../../git/hooks-path.js');
          const hookMarker = '# [memorix-git-hook]';
          const resolved = ensureHooksDir(cwd);
          if (!resolved) {
            setActionStatus('No .git found. Run inside a git repository.');
            break;
          }
          const hookScript = `${hookMarker}
# Memorix: Auto-ingest git commits as memories
# Runs in background - does not block your commit workflow.
# To remove: memorix git-hook uninstall
if command -v memorix >/dev/null 2>&1; then
  memorix ingest commit --auto >/dev/null 2>&1 &
fi
`;
          if (existsSync(resolved.hookPath)) {
            const existing = readFileSync(resolved.hookPath, 'utf-8');
            if (existing.includes(hookMarker)) {
              setActionStatus('Post-commit hook already installed.');
              break;
            }
            const appended = `${existing.trimEnd()}\n\n${hookScript}`;
            writeFileSync(resolved.hookPath, appended, 'utf-8');
          } else {
            writeFileSync(resolved.hookPath, `#!/bin/sh\n${hookScript}`, 'utf-8');
          }
          try { chmodSync(resolved.hookPath, 0o755); } catch { /* Windows */ }
          setActionStatus('Post-commit hook installed.');
          break;
        }
        case '4': {
          const { existsSync, readFileSync, writeFileSync, unlinkSync } = await import('node:fs');
          const { resolveHooksDir } = await import('../../git/hooks-path.js');
          const hookMarker = '# [memorix-git-hook]';
          const resolved = resolveHooksDir(cwd);
          if (!resolved || !existsSync(resolved.hookPath)) {
            setActionStatus('No post-commit hook found.');
            break;
          }
          const content = readFileSync(resolved.hookPath, 'utf-8');
          if (!content.includes(hookMarker)) {
            setActionStatus('No memorix hook installed.');
            break;
          }
          const filtered: string[] = [];
          let inMemorixBlock = false;
          for (const line of content.split('\n')) {
            if (line.includes(hookMarker)) {
              inMemorixBlock = true;
              continue;
            }
            if (inMemorixBlock) {
              if (line.trim() === '' || line.startsWith('#!') || line.startsWith('# [')) {
                if (line.trim() !== '') filtered.push(line);
                inMemorixBlock = false;
              }
              continue;
            }
            filtered.push(line);
          }
          const remaining = filtered.join('\n').trim();
          if (!remaining || remaining === '#!/bin/sh') {
            unlinkSync(resolved.hookPath);
          } else {
            writeFileSync(resolved.hookPath, `${remaining}\n`, 'utf-8');
          }
          setActionStatus('Post-commit hook uninstalled.');
          break;
        }
        default: setActionStatus('');
      }
      await refreshSummary();
    } catch (err) {
      setActionStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [getProjectRoot, refreshSummary]);

  const handleIntegrateAction = useCallback(async (action: string) => {
    const agentKeyMap: Record<string, string> = {
      '1': 'claude', '2': 'windsurf', '3': 'cursor', '4': 'copilot',
      '5': 'kiro', '6': 'codex', '7': 'antigravity', '8': 'opencode',
      '9': 'trae', '0': 'gemini-cli',
    };
    const agent = agentKeyMap[action];
    if (!agent) {
      setActionStatus('');
      return;
    }
    setActionStatus('Executing...');
    try {
      const cwd = (await getProjectRoot()) ?? process.cwd();
      const { installHooks } = await import('../../hooks/installers/index.js');
      const result = await installHooks(agent as import('../../hooks/types.js').AgentName, cwd, false);
      setActionStatus(`Installed ${agent} integration -> ${result.configPath}`);
    } catch (err) {
      setActionStatus(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [getProjectRoot]);

  const handleBackgroundAction = useCallback(async (action: string) => {
    setStatusMsg(null);
    try {
      const { execSync } = await import('node:child_process');
      if (background.running) {
        switch (action) {
          case 'w':
            if (background.dashboard) {
              try { execSync(`start "" "${background.dashboard}"`, { stdio: 'pipe' }); } catch {
                try { execSync(`open "${background.dashboard}"`, { stdio: 'pipe' }); } catch {
                  try { execSync(`xdg-open "${background.dashboard}"`, { stdio: 'pipe' }); } catch { /* */ }
                }
              }
              setStatusMsg({ text: `Opening ${background.dashboard}`, type: 'success' });
            }
            break;
          case '1':
            try { execSync('memorix background restart', { stdio: 'pipe', timeout: 15000 }); setStatusMsg({ text: 'Restarted.', type: 'success' }); }
            catch (e) { setStatusMsg({ text: `Restart failed: ${e instanceof Error ? e.message : e}`, type: 'error' }); }
            break;
          case '2':
            try { execSync('memorix background stop', { stdio: 'pipe', timeout: 10000 }); setStatusMsg({ text: 'Stopped.', type: 'success' }); }
            catch (e) { setStatusMsg({ text: `Stop failed: ${e instanceof Error ? e.message : e}`, type: 'error' }); }
            break;
          case '3':
            setStatusMsg({ text: 'Run: memorix background logs (separate terminal)', type: 'info' });
            break;
        }
      } else {
        switch (action) {
          case '1':
            try { execSync('memorix background start', { stdio: 'pipe', timeout: 15000 }); setStatusMsg({ text: 'Started.', type: 'success' }); }
            catch (e) { setStatusMsg({ text: `Start failed: ${e instanceof Error ? e.message : e}`, type: 'error' }); }
            break;
          case '2':
            setStatusMsg({ text: 'Run: memorix dashboard (separate terminal)', type: 'info' });
            break;
        }
      }
      setBackground(await getBackgroundStatus());
    } catch (err) {
      setStatusMsg({ text: `Error: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    }
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
        } else if (action === '2') {
          setStatusMsg({ text: 'Run: memorix dashboard (separate terminal)', type: 'info' });
        }
      } else {
        if (action === '1') {
          try { execSync('memorix background start', { stdio: 'pipe', timeout: 15000 }); setStatusMsg({ text: 'Started. Use /dashboard again.', type: 'success' }); setBackground(await getBackgroundStatus()); }
          catch (e) { setStatusMsg({ text: `Start failed: ${e instanceof Error ? e.message : e}`, type: 'error' }); }
        } else if (action === '2') {
          setStatusMsg({ text: 'Run: memorix dashboard (separate terminal)', type: 'info' });
        }
      }
    } catch (err) {
      setStatusMsg({ text: `Error: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    }
  }, [background]);

  // ── Render main content based on view ──────────────────────
  const renderContent = () => {
    switch (view) {
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
        return <ConfigureView onBack={() => handleCommand('/home')} />;
      case 'home':
      default:
        return (
          <Box flexDirection="column" paddingX={2} paddingY={1}>
            <Text color={COLORS.brand} bold>Memorix Workbench</Text>
            <Text color={COLORS.border}>{'─'.repeat(getHomeSeparatorWidth(contentWidth))}</Text>
            <Box marginTop={1} flexDirection="column">
              <Text color={COLORS.text}>Your project memory control plane.</Text>
              <Text color={COLORS.textDim}>Ask questions, search memories, manage context.</Text>
            </Box>
            <Box marginTop={1} flexDirection="column">
              <Text color={COLORS.muted}>Quick actions</Text>
              <Text color={COLORS.textDim}>{'  > /chat ask with memory'}</Text>
              <Text color={COLORS.textDim}>{'  > /search inspect hits'}</Text>
              <Text color={COLORS.textDim}>{'  > /recent recent activity'}</Text>
              <Text color={COLORS.textDim}>{'  > /remember store a note'}</Text>
              <Text color={COLORS.textDim}>{'  > /doctor diagnostics'}</Text>
            </Box>
            {project && (
              <Box marginTop={1} flexDirection="column">
                <Text color={COLORS.muted}>Project</Text>
                <Text color={COLORS.text}>{`  ${project.name} · ${health.activeMemories} memories · ${health.searchModeLabel}`}</Text>
              </Box>
            )}
            <Box marginTop={1}>
              <Text color={COLORS.textDim}>Type a question below to chat, or /help for all commands</Text>
            </Box>
          </Box>
        );
    }
  };

  // ── Layout ─────────────────────────────────────────────────
  const termWidth = stdout?.columns || 80;
  const termHeight = stdout?.rows || 24;
  const { sidebarWidth, contentWidth, narrow, veryNarrow } = computeLayoutWidths(termWidth);
  const statusRows = statusMsg ? getStatusMessageRows(statusMsg.text) : 0;
  // Keep header and command bar visible during terminal resize.
  // Palette is rendered as an overlay — does not affect layout height.
  const reservedRows = 2 + statusRows + (COMMAND_BAR_ROWS + 1);
  const mainAreaHeight = Math.max(6, termHeight - reservedRows);
  const paletteHeight = getCommandPaletteHeight(paletteItems.length);
  const paletteTopInContent = Math.max(0, mainAreaHeight - paletteHeight);
  const paletteSeparatorWidth = Math.max(8, Math.min(30, contentWidth - 10));

  return (
    <Box flexDirection="column" height={termHeight}>
      {/* Header */}
      <HeaderBar version={version} project={project} health={health} mode={mode} />

      {/* Main area: content + sidebar */}
      <Box
        flexDirection={narrow ? 'column' : 'row'}
        height={mainAreaHeight}
        flexGrow={0}
        flexShrink={1}
      >
        {/* Main content — palette overlays here so it never affects sidebar */}
        <Box
          flexGrow={1}
          flexShrink={1}
          flexDirection="column"
          paddingRight={narrow ? 0 : 1}
        >
          {renderContent()}

          {/* Command palette overlay — absolute inside the content column.
              Manual border rendering: every cell is explicitly written so
              underlying CJK wide-chars cannot bleed through. */}
          {paletteVisible && paletteItems.length > 0 && (() => {
            // Cover the FULL content column so nothing bleeds through.
            const contentColW = termWidth - (narrow ? 0 : sidebarWidth) - (narrow ? 0 : 1);
            const palBoxW = Math.max(40, contentColW);
            // inner = total - border(1) - space(1) on each side = total - 4
            const palInner = palBoxW - 4;
            // Pad string to exact palInner chars (ASCII-only content, so length == display width)
            const padText = (s: string) =>
              s.length >= palInner ? s.slice(0, palInner) : s + ' '.repeat(palInner - s.length);
            // Build full-width line: │ <content> │ — every cell explicitly written
            const row = (content: string, fg: string, bold = false) => (
              <Text key={content.slice(0, 20)} color={fg} bold={bold}>
                <Text color={COLORS.border}>{'│ '}</Text>{padText(content)}<Text color={COLORS.border}>{' │'}</Text>
              </Text>
            );
            const hBorder = '─'.repeat(palBoxW - 2);

            return (
              <Box
                position="absolute"
                flexDirection="column"
                width={palBoxW}
                marginTop={paletteTopInContent}
              >
                <Text color={COLORS.border}>{'┌' + hBorder + '┐'}</Text>
                {row('Commands', COLORS.brand, true)}
                {row('─'.repeat(Math.min(palInner, paletteSeparatorWidth)), COLORS.border)}
                {paletteItems.map((cmd, index) => {
                  const prefix = index === paletteSelectedIdx ? '> ' : '  ';
                  const name = cmd.name.padEnd(16).slice(0, 16);
                  const desc = cmd.description + (cmd.alias ? ` (${cmd.alias})` : '');
                  return (
                    <Text key={cmd.name} color={index === paletteSelectedIdx ? COLORS.brand : COLORS.text} bold={index === paletteSelectedIdx}>
                      <Text color={COLORS.border}>{'│ '}</Text>{padText(prefix + name + desc)}<Text color={COLORS.border}>{' │'}</Text>
                    </Text>
                  );
                })}
                {row('↑↓ navigate │ Tab complete │ Enter execute', COLORS.muted)}
                <Text color={COLORS.border}>{'└' + hBorder + '┘'}</Text>
              </Box>
            );
          })()}
        </Box>

        {/* Sidebar: full at >=80, compact health-only at 60-79, hidden at <60 */}
        {!narrow ? (
          <ContextRail
            project={project}
            health={health}
            background={background}
            activeView={view}
            lastChat={lastChat}
            transcriptCount={chatMessages.length}
            width={sidebarWidth}
          />
        ) : !veryNarrow ? (
          <Box flexDirection="column" width={24} flexShrink={0} paddingLeft={1} borderStyle="single" borderColor={COLORS.border} borderLeft={true} borderTop={false} borderRight={false} borderBottom={false}>
            <Text color={COLORS.brand} bold wrap="truncate-end">Context</Text>
            <Box><Text color={COLORS.muted} wrap="truncate-end">View </Text><Text color={COLORS.text} wrap="truncate-end">{view}</Text></Box>
            <Box><Text color={COLORS.muted} wrap="truncate-end">Mem  </Text><Text color={COLORS.text} wrap="truncate-end">{health.activeMemories}</Text></Box>
            <Box><Text color={COLORS.muted} wrap="truncate-end">Mode </Text><Text color={health.embeddingProvider === 'ready' ? COLORS.success : COLORS.muted} wrap="truncate-end">{health.searchModeLabel}</Text></Box>
            <Box><Text color={COLORS.muted} wrap="truncate-end">Msgs </Text><Text color={COLORS.text} wrap="truncate-end">{chatMessages.length}</Text></Box>
            <Box marginTop={1}><Text color={COLORS.textDim} wrap="truncate-end">/chat /search /recent</Text></Box>
          </Box>
        ) : null}
        {/* Very narrow (<60): inline minimal status hint above command bar */}
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
          disabled={isActionView}
          onFocusChange={setInputFocused}
          prefixLabel={view === 'chat' ? '[ask]' : '[cmd]'}
          placeholder={view === 'chat' ? 'ask Memorix about this project or use /command' : 'type a question or /command'}
          contentWidth={contentWidth}
          onPaletteChange={setPaletteVisible}
          onPaletteItems={handlePaletteItemsChange}
          disabledHint={
            view === 'cleanup' ? 'cleanup: 1/2/3, h or Esc'
            : view === 'ingest' ? 'ingest: 1/2/3/4, h or Esc'
            : view === 'integrate' ? 'integrate: 0-9, h or Esc'
            : view === 'configure' ? 'configure: Up/Down/Enter, Esc to back'
            : view === 'background'
              ? background.running ? 'background: w/1/2/3, h or Esc' : 'background: 1/2, h or Esc'
            : view === 'dashboard' ? 'dashboard: 1/2, h or Esc'
            : 'action view active'
          }
        />
      </Box>
    </Box>
  );
}

function truncateTitle(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}
