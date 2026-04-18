/**
 * WorkbenchApp — Main Ink application for Memorix TUI
 *
 * Three-panel layout: HeaderBar + (MainContent | Sidebar) + CommandBar
 * Manages global state, view routing, and command execution.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useStdout, useInput } from 'ink';
import { COLORS, SLASH_COMMANDS } from './theme.js';
import type { ViewType } from './theme.js';
import { HeaderBar } from './HeaderBar.js';
import { Sidebar } from './Sidebar.js';
import { CommandBar } from './CommandBar.js';
import {
  HomeView,
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

interface AppProps {
  version: string;
  onExitForInteractive: (cmd: string) => void;
}

export function WorkbenchApp({ version, onExitForInteractive }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();

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
  // Derived from centralized navigation model
  const isActionView = ACTION_VIEWS.has(view);
  const canEscReturnHome = ESC_RETURNABLE_VIEWS.has(view);
  // Track whether CommandBar is actively receiving text input
  const [inputFocused, setInputFocused] = useState(false);

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
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

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
          break;
        }

        case 'home':
        case 'h': {
          setView('home');
          break;
        }

        case 'cleanup': {
          setView('cleanup');
          setActionStatus('');
          break;
        }

        case 'ingest': {
          setView('ingest');
          setActionStatus('');
          break;
        }

        case 'doctor': {
          setView('doctor');
          setLoading(true);
          const d = await getDoctorSummary();
          setDoctor(d);
          setLoading(false);
          break;
        }

        case 'project':
        case 'status': {
          setView('project');
          break;
        }

        case 'background':
        case 'bg': {
          setView('background');
          setLoading(true);
          const bg = await getBackgroundStatus();
          setBackground(bg);
          setLoading(false);
          break;
        }

        case 'dashboard':
        case 'dash': {
          setView('dashboard');
          // Refresh background info for dashboard URL
          const bg = await getBackgroundStatus();
          setBackground(bg);
          break;
        }

        case 'integrate':
        case 'setup': {
          setView('integrate');
          setActionStatus('');
          break;
        }

        case 'configure':
        case 'config': {
          setView('configure');
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
      // Default: search
      setView('search');
      setSearchQuery(raw);
      setLoading(true);
      const results = await searchMemories(raw);
      setSearchResults(results);
      setLoading(false);
      // Refresh health so Search Mode / diagnostic reflects actual search path
      setHealth(await getHealthInfo(project?.id));
    }
  }, [project, exit, onExitForInteractive]);

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
        return <HomeView project={project} health={health} background={background} loading={loading} />;
    }
  };

  // ── Layout ─────────────────────────────────────────────────
  const termWidth = stdout?.columns || 80;
  const termHeight = stdout?.rows || 24;
  const narrow = termWidth < 80;
  const veryNarrow = termWidth < 60;
  const statusRows = statusMsg ? 1 : 0;
  // Keep header and command bar visible during terminal resize.
  const reservedRows = 2 + statusRows + 3;
  const mainAreaHeight = Math.max(6, termHeight - reservedRows);

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
        {/* Main content */}
        <Box
          flexGrow={1}
          flexShrink={1}
          flexDirection="column"
          borderStyle="single"
          borderColor={COLORS.border}
        >
          {renderContent()}
        </Box>

        {/* Sidebar: full at >=80, compact health-only at 60-79, hidden at <60 */}
        {!narrow ? (
          <Sidebar
            health={health}
            background={background}
            onAction={handleCommand}
            activeView={view}
            isFocused={!isActionView && !inputFocused}
          />
        ) : !veryNarrow ? (
          <Box flexDirection="column" width={20} borderStyle="single" borderColor={COLORS.border} paddingX={1}>
            <Text color={COLORS.accentDim} bold>Health</Text>
            <Box><Text color={COLORS.muted}>Mem </Text><Text color={COLORS.text}>{health.activeMemories}</Text></Box>
            <Box><Text color={COLORS.muted}>Emb </Text><Text color={health.embeddingProvider === 'ready' ? COLORS.success : COLORS.muted}>{health.embeddingLabel}</Text></Box>
            <Box><Text color={COLORS.muted}>Bg  </Text><Text color={background.healthy ? COLORS.success : COLORS.muted}>{background.healthy ? 'Up' : 'Down'}</Text></Box>
            <Box marginTop={1}><Text color={COLORS.textDim}>h=home /=cmd</Text></Box>
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
