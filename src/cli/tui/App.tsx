/**
 * WorkbenchApp -- Main Ink application for Memorix TUI
 *
 * Unified center-first layout inspired by OpenCode.
 * No fixed sidebar. Bottom status bar.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useStdout } from 'ink';
import { COLORS, SLASH_COMMANDS } from './theme.js';
import type { ViewType } from './theme.js';
import { CommandBar } from './CommandBar.js';
import {
  LandingView,
  SearchResultsView,
  DoctorView,
  ProjectView,
  BackgroundView,
  DashboardView,
  StatusMessage,
} from './Panels.js';
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
  getHighValueSignals,
  getBackgroundStatus,
  searchMemories,
  storeQuickMemory,
  getDoctorSummary,
  detectMode,
} from './data.js';

interface AppProps {
  version: string;
  onExitForInteractive: (cmd: string) => void;
}

export function WorkbenchApp({ version, onExitForInteractive }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();

  // -- State
  const [view, setView] = useState<ViewType>('home');
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [health, setHealth] = useState<HealthInfo>({
    embeddingProvider: 'disabled', searchMode: 'BM25',
    backfillPending: 0, totalMemories: 0, activeMemories: 0, sessions: 0,
  });
  const [background, setBackground] = useState<BackgroundInfo>({ running: false, healthy: false });
  const [recentMemories, setRecentMemories] = useState<MemoryItem[]>([]);
  const [highValueSignals, setHighValueSignals] = useState<MemoryItem[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [doctor, setDoctor] = useState<DoctorResult | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [mode, setMode] = useState('CLI');

  // -- Initial data load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [proj, recent, signals, bg] = await Promise.all([
          getProjectInfo(),
          getRecentMemories(4),
          getHighValueSignals(2),
          getBackgroundStatus(),
        ]);
        if (cancelled) return;
        setProject(proj);
        setRecentMemories(recent);
        setHighValueSignals(signals);
        setBackground(bg);

        const h = await getHealthInfo(proj?.id);
        if (cancelled) return;
        setHealth(h);
        setMode(detectMode().mode);
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // -- Command handler
  const handleCommand = useCallback(async (input: string) => {
    const raw = input.trim();
    if (!raw) return;
    setStatusMsg(null);

    if (raw.startsWith('/')) {
      const parts = raw.slice(1).split(/\s+/);
      const cmd = parts[0]?.toLowerCase() || '';
      const arg = parts.slice(1).join(' ');

      const cmdDef = SLASH_COMMANDS.find(c =>
        c.name === `/${cmd}` || c.alias === `/${cmd}`
      );
      if (cmdDef?.interactive) {
        onExitForInteractive(`/${cmd}`);
        return;
      }

      switch (cmd) {
        case 'search': case 's': {
          const query = arg || '';
          if (!query) { setStatusMsg({ text: 'Usage: /search <query>', type: 'info' }); return; }
          setView('search'); setSearchQuery(query); setLoading(true);
          setSearchResults(await searchMemories(query)); setLoading(false);
          break;
        }
        case 'remember': case 'r': {
          if (!arg) { setStatusMsg({ text: 'Usage: /remember <text>', type: 'info' }); return; }
          setLoading(true);
          const stored = await storeQuickMemory(arg);
          setLoading(false);
          if (stored) {
            setStatusMsg({ text: `Stored #${stored.id}: ${stored.title}`, type: 'success' });
            setRecentMemories(await getRecentMemories(4));
            setHealth(await getHealthInfo(project?.id));
          } else {
            setStatusMsg({ text: 'Failed to store memory', type: 'error' });
          }
          break;
        }
        case 'recent': {
          setView('home'); setLoading(true);
          setRecentMemories(await getRecentMemories(6)); setLoading(false);
          break;
        }
        case 'doctor': {
          setView('doctor'); setLoading(true);
          setDoctor(await getDoctorSummary()); setLoading(false);
          break;
        }
        case 'project': case 'status': { setView('project'); break; }
        case 'background': case 'bg': {
          setView('background'); setLoading(true);
          setBackground(await getBackgroundStatus()); setLoading(false);
          break;
        }
        case 'dashboard': case 'dash': {
          setView('dashboard');
          setBackground(await getBackgroundStatus());
          break;
        }
        case 'help': case '?': {
          setStatusMsg({
            text: SLASH_COMMANDS.map(c =>
              `${c.name.padEnd(16)} ${c.description}${c.alias ? ` (${c.alias})` : ''}`
            ).join('\n'),
            type: 'info',
          });
          break;
        }
        case 'exit': case 'quit': case 'q': { exit(); return; }
        default:
          setStatusMsg({ text: `Unknown: /${cmd}. Type /help`, type: 'error' });
      }
    } else {
      setView('search'); setSearchQuery(raw); setLoading(true);
      setSearchResults(await searchMemories(raw)); setLoading(false);
    }
  }, [project, exit, onExitForInteractive]);

  // -- Render content
  const renderContent = () => {
    switch (view) {
      case 'search':
        return <SearchResultsView results={searchResults} query={searchQuery} loading={loading} />;
      case 'doctor':
        return <DoctorView doctor={doctor} health={health} background={background} project={project} loading={loading} />;
      case 'project':
        return <ProjectView project={project} health={health} />;
      case 'background':
        return <BackgroundView background={background} loading={loading} />;
      case 'dashboard':
        return <DashboardView background={background} />;
      case 'home': default:
        return <LandingView recentMemories={recentMemories} highValueSignals={highValueSignals} project={project} background={background} health={health} loading={loading} />;
    }
  };

  // -- Layout: unified, no sidebar, bottom status bar
  return (
    <Box flexDirection="column" height="100%">
      {/* Main content -- full width, no border, no sidebar */}
      <Box flexGrow={1} flexDirection="column">
        {renderContent()}
      </Box>

      {/* Status message */}
      {statusMsg && <StatusMessage message={statusMsg.text} type={statusMsg.type} />}

      {/* Command bar */}
      <CommandBar onSubmit={handleCommand} onExit={() => exit()} />

      {/* Bottom status bar -- OpenCode style */}
      <Box paddingX={1} justifyContent="space-between">
        <Box gap={1}>
          <Text color={COLORS.muted}>~</Text>
          <Text color={COLORS.text}>{project?.name || 'no project'}</Text>
          <Text color={COLORS.muted}>
            {health.activeMemories} memories
          </Text>
          <Text color={health.searchMode.includes('hybrid') ? COLORS.success : COLORS.muted}>
            {health.searchMode}
          </Text>
        </Box>
        <Text color={COLORS.muted}>v{version}</Text>
      </Box>
    </Box>
  );
}
