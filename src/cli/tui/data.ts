/**
 * Memorix TUI data layer.
 *
 * Pure data functions that return structured results without console output.
 * Used by Ink components to populate panels.
 */

import * as fs from 'node:fs';

export interface ProjectInfo {
  name: string;
  id: string;
  rootPath: string;
  gitRemote: string;
}

export interface HealthInfo {
  embeddingProvider: 'ready' | 'unavailable' | 'disabled';
  embeddingProviderName?: string;
  embeddingLabel: string;
  searchMode: string;
  searchModeLabel: string;
  searchDiagnostic: string;
  backfillPending: number;
  totalMemories: number;
  activeMemories: number;
  sessions: number;
}

export interface MemoryItem {
  id: number;
  title: string;
  type: string;
  createdAt: string;
  entityName: string;
  status?: string;
}

export interface BackgroundInfo {
  running: boolean;
  healthy: boolean;
  pid?: number;
  port?: number;
  startedAt?: string;
  dashboard?: string;
  mcp?: string;
  agents?: number;
  sessions?: number;
  uptime?: string;
  message?: string;
}

export interface SearchResult {
  id: number;
  title: string;
  type: string;
  score: number;
  entityName: string;
  icon: string;
}

export interface DoctorResult {
  sections: DoctorSection[];
}

export interface DoctorSection {
  title: string;
  items: { label: string; value: string; status: 'ok' | 'warn' | 'error' | 'info' }[];
}

function formatSearchModeLabel(mode: string): string {
  const normalized = (mode || '').toLowerCase();
  if (!normalized) return 'Unknown';
  if (normalized.includes('hybrid') && normalized.includes('rerank')) return 'Hybrid + rerank';
  if (normalized.includes('hybrid')) return 'Hybrid';
  if (normalized.includes('vector-only')) return 'Vector fallback';
  if (normalized.includes('vector')) return 'Vector';
  if (normalized.includes('fulltext')) return 'BM25 full-text';
  return mode;
}

function formatEmbeddingLabel(
  status: HealthInfo['embeddingProvider'],
  providerName?: string,
): string {
  if (status === 'disabled') return 'Disabled';
  if (status === 'unavailable') return 'Unavailable';
  if ((providerName || '').startsWith('api-')) return 'API ready';
  if (providerName) return 'Local ready';
  return 'Ready';
}

function truncate(text: string, max = 60): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

export async function getProjectInfo(): Promise<ProjectInfo | null> {
  try {
    const { detectProject } = await import('../../project/detector.js');
    const proj = detectProject(process.cwd());
    if (!proj) return null;
    return {
      name: proj.name,
      id: proj.id,
      rootPath: proj.rootPath,
      gitRemote: proj.gitRemote || 'none',
    };
  } catch {
    return null;
  }
}

export async function getHealthInfo(projectId?: string): Promise<HealthInfo> {
  const defaults: HealthInfo = {
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
  };

  try {
    const { detectProject } = await import('../../project/detector.js');
    const { getProjectDataDir } = await import('../../store/persistence.js');
    const { initObservationStore: initStore, getObservationStore: getStore } = await import('../../store/obs-store.js');

    const proj = detectProject(process.cwd());
    if (!proj) return defaults;

    // Load .env BEFORE any process.env reads or provider initialization (#46)
    try {
      const { loadDotenv } = await import('../../config/dotenv-loader.js');
      loadDotenv(proj.rootPath);
    } catch { /* best-effort */ }

    const effectiveProjectId = projectId || proj.id;
    const dataDir = await getProjectDataDir(effectiveProjectId);
    await initStore(dataDir);
    const allObs = (await getStore().loadAll()) as any[];
    // Filter by project — flat storage shares one observations.json across projects
    const obs = allObs.filter((o: any) => o.projectId === effectiveProjectId);
    const active = obs.filter((o: any) => (o.status ?? 'active') === 'active');

    defaults.totalMemories = obs.length;
    defaults.activeMemories = active.length;

    try {
      const { initSessionStore, getSessionStore } = await import('../../store/session-store.js');
      await initSessionStore(dataDir);
      const sessStore = getSessionStore();
      const allSessions = await sessStore.loadAll() as any[];
      defaults.sessions = allSessions.filter((s: any) => s.projectId === effectiveProjectId).length;
    } catch {
      // Ignore unreadable session data and keep defaults.
    }

    try {
      const { getEmbeddingProvider, isEmbeddingExplicitlyDisabled } = await import('../../embedding/provider.js');
      if (isEmbeddingExplicitlyDisabled()) {
        defaults.embeddingProvider = 'disabled';
      } else {
        const provider = await getEmbeddingProvider();
        defaults.embeddingProvider = provider ? 'ready' : 'unavailable';
        defaults.embeddingProviderName = provider?.name;
      }
      defaults.embeddingLabel = formatEmbeddingLabel(
        defaults.embeddingProvider,
        defaults.embeddingProviderName,
      );
    } catch {
      defaults.embeddingProvider = 'unavailable';
      defaults.embeddingLabel = 'Unavailable';
    }

    try {
      const { getLastSearchMode, isEmbeddingEnabled } = await import('../../store/orama-store.js');
      const vectorActive = isEmbeddingEnabled();
      defaults.searchMode = getLastSearchMode(effectiveProjectId);
      defaults.searchModeLabel = formatSearchModeLabel(defaults.searchMode);

      // Build diagnostic explanation
      if (defaults.searchMode.includes('hybrid')) {
        defaults.searchDiagnostic = 'Hybrid search active';
      } else if (defaults.searchMode.includes('vector')) {
        defaults.searchDiagnostic = 'Vector fallback (BM25 empty)';
      } else if (defaults.searchMode.includes('rerank')) {
        defaults.searchDiagnostic = 'LLM reranking active';
      } else if (defaults.searchMode.includes('embedding unavailable')) {
        defaults.searchDiagnostic = 'Embedding unavailable';
      } else if (defaults.embeddingProvider === 'ready' && vectorActive) {
        defaults.searchDiagnostic = 'Vector index ready';
      } else if (defaults.embeddingProvider === 'ready' && !vectorActive) {
        defaults.searchDiagnostic = 'Provider ready, no index yet';
      } else if (defaults.embeddingProvider === 'unavailable') {
        defaults.searchDiagnostic = 'BM25 only (no provider)';
      } else {
        defaults.searchDiagnostic = 'BM25 only (disabled)';
      }
    } catch {
      defaults.searchMode = 'fulltext';
      defaults.searchModeLabel = 'BM25 full-text';
      defaults.searchDiagnostic = 'Could not determine search mode';
    }

    return defaults;
  } catch {
    return defaults;
  }
}

export async function getRecentMemories(limit = 8, projectId?: string): Promise<MemoryItem[]> {
  try {
    const { detectProject } = await import('../../project/detector.js');
    const { getProjectDataDir } = await import('../../store/persistence.js');
    const { initObservationStore: initStore, getObservationStore: getStore } = await import('../../store/obs-store.js');

    const proj = detectProject(process.cwd());
    if (!proj) return [];

    const effectiveProjectId = projectId || proj.id;
    const dataDir = await getProjectDataDir(effectiveProjectId);
    await initStore(dataDir);
    const allObs = (await getStore().loadAll()) as any[];
    // Filter by project — flat storage shares one observations.json
    const projectObs = allObs.filter((o: any) => o.projectId === effectiveProjectId);
    const active = projectObs.filter((o: any) => (o.status ?? 'active') === 'active');
    const filtered = active.filter((o: any) => !/^(Ran:|Command:|Executed:)\s/i.test(o.title || ''));

    return filtered.slice(-limit).reverse().map((o: any) => ({
      id: o.id,
      title: o.title || '(untitled)',
      type: o.type || 'discovery',
      createdAt: o.createdAt || '',
      entityName: o.entityName || '',
      status: o.status,
    }));
  } catch {
    return [];
  }
}

export async function searchMemories(query: string, limit = 10): Promise<SearchResult[]> {
  try {
    const { searchObservations, getDb, hydrateIndex } = await import('../../store/orama-store.js');
    const { getProjectDataDir } = await import('../../store/persistence.js');
    const { detectProject } = await import('../../project/detector.js');
    const { initObservations } = await import('../../memory/observations.js');
    const { initObservationStore, getObservationStore: getStore } = await import('../../store/obs-store.js');

    const proj = detectProject(process.cwd());
    if (!proj) return [];

    const dataDir = await getProjectDataDir(proj.id);
    await initObservationStore(dataDir);
    await initObservations(dataDir);
    await getDb();

    const allObs = (await getStore().loadAll()) as any[];
    await hydrateIndex(allObs);

    const results = await searchObservations({ query, limit, projectId: proj.id });

    const typeIcons: Record<string, string> = {
      gotcha: '!',
      decision: 'D',
      'problem-solution': 'S',
      discovery: '?',
      'how-it-works': 'H',
      'what-changed': 'C',
      'trade-off': 'T',
      reasoning: 'R',
    };

    return results.map((r: any) => ({
      id: r.id,
      title: r.title || '(untitled)',
      type: r.type || 'discovery',
      score: r.score ?? 0,
      entityName: r.entityName || '',
      icon: typeIcons[r.type] || '?',
    }));
  } catch {
    return [];
  }
}

export async function storeQuickMemory(text: string): Promise<{ id: number; title: string } | null> {
  try {
    const { detectProject } = await import('../../project/detector.js');
    const { getProjectDataDir } = await import('../../store/persistence.js');
    const { initObservations, storeObservation } = await import('../../memory/observations.js');
    const { initObservationStore } = await import('../../store/obs-store.js');

    const proj = detectProject(process.cwd());
    if (!proj) return null;

    const dataDir = await getProjectDataDir(proj.id);
    await initObservationStore(dataDir);
    await initObservations(dataDir);

    const result = await storeObservation({
      entityName: 'quick-note',
      type: 'discovery',
      title: text.slice(0, 100),
      narrative: text,
      facts: [],
      projectId: proj.id,
      sourceDetail: 'explicit',
    });

    return { id: result.observation.id, title: text.slice(0, 100) };
  } catch {
    return null;
  }
}

export async function getBackgroundStatus(): Promise<BackgroundInfo> {
  const result: BackgroundInfo = { running: false, healthy: false };

  try {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const statePath = `${home.replace(/\\/g, '/')}/.memorix/background.json`;

    if (!fs.existsSync(statePath)) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetch('http://127.0.0.1:3211/api/team', { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) {
          const data = (await res.json()) as any;
          result.running = true;
          result.healthy = true;
          result.port = 3211;
          result.dashboard = 'http://127.0.0.1:3211/';
          result.mcp = 'http://127.0.0.1:3211/mcp';
          result.agents = data.agents?.length ?? 0;
          result.sessions = data.sessions ?? 0;
          result.message = 'Foreground instance detected';
        }
      } catch {
        // Not running.
      }
      return result;
    }

    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    result.pid = state.pid;
    result.port = state.port;
    result.startedAt = state.startedAt;
    result.dashboard = `http://127.0.0.1:${state.port}/`;
    result.mcp = `http://127.0.0.1:${state.port}/mcp`;

    try {
      process.kill(state.pid, 0);
      result.running = true;
    } catch {
      result.message = 'Process exited';
      return result;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`http://127.0.0.1:${state.port}/api/team`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = (await res.json()) as any;
        result.healthy = true;
        result.agents = data.agents?.length ?? 0;
        result.sessions = data.sessions ?? 0;
        result.uptime = data.uptime;
      }
    } catch {
      result.message = 'Running but unhealthy';
    }

    return result;
  } catch {
    return result;
  }
}

export async function getDoctorSummary(): Promise<DoctorResult> {
  const result: DoctorResult = { sections: [] };

  try {
    const proj = await getProjectInfo();
    const projectItems: DoctorSection['items'] = [];
    if (proj) {
      projectItems.push({ label: 'Name', value: proj.name, status: 'ok' });
      projectItems.push({ label: 'ID', value: truncate(proj.id, 16), status: 'info' });
      projectItems.push({
        label: 'Remote',
        value: proj.gitRemote,
        status: proj.gitRemote !== 'none' ? 'ok' : 'warn',
      });
    } else {
      projectItems.push({ label: 'Project', value: 'Not detected (no .git)', status: 'error' });
    }
    result.sections.push({ title: 'Project', items: projectItems });

    const health = await getHealthInfo(proj?.id);
    result.sections.push({
      title: 'Data',
      items: [
        { label: 'Total', value: `${health.totalMemories}`, status: 'info' },
        { label: 'Active', value: `${health.activeMemories}`, status: health.activeMemories > 0 ? 'ok' : 'warn' },
        { label: 'Sessions', value: `${health.sessions}`, status: 'info' },
      ],
    });

    const searchItems: DoctorSection['items'] = [
      { label: 'Search Mode', value: health.searchModeLabel, status: 'info' },
      { label: 'Embedding', value: health.embeddingLabel, status: health.embeddingProvider === 'ready' ? 'ok' : 'info' },
    ];
    if (health.embeddingProviderName) {
      searchItems.push({ label: 'Provider', value: health.embeddingProviderName, status: 'info' });
    }
    result.sections.push({ title: 'Search', items: searchItems });

    const bg = await getBackgroundStatus();
    result.sections.push({
      title: 'Background',
      items: [
        {
          label: 'Status',
          value: bg.healthy ? 'Running & healthy' : bg.running ? 'Running (unhealthy)' : 'Not running',
          status: bg.healthy ? 'ok' : bg.running ? 'warn' : 'info',
        },
        ...(bg.port ? [{ label: 'Port', value: `${bg.port}`, status: 'info' as const }] : []),
      ],
    });
  } catch (err) {
    result.sections.push({
      title: 'Error',
      items: [{ label: 'Diagnostics failed', value: err instanceof Error ? err.message : String(err), status: 'error' }],
    });
  }

  return result;
}

export function detectMode(): { mode: string; detail: string } {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const statePath = `${home.replace(/\\/g, '/')}/.memorix/background.json`;
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      try {
        process.kill(state.pid, 0);
        return { mode: 'Background', detail: `port ${state.port}` };
      } catch {
        // Ignore dead process and fall back to CLI.
      }
    }
  } catch {
    // Ignore state read failures and fall back to CLI.
  }
  return { mode: 'CLI', detail: 'Quick mode' };
}
