/**
 * Memorix TUI Data Layer — Shared data fetching functions
 *
 * Pure data functions that return structured results without console output.
 * Used by Ink components to populate panels.
 */

import * as fs from 'node:fs';

// ── Types ──────────────────────────────────────────────────────

export interface ProjectInfo {
  name: string;
  id: string;
  rootPath: string;
  gitRemote: string;
}

export interface HealthInfo {
  embeddingProvider: 'ready' | 'unavailable' | 'disabled';
  searchMode: string;
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

// ── Project ────────────────────────────────────────────────────

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

// ── Health ──────────────────────────────────────────────────────

export async function getHealthInfo(projectId?: string): Promise<HealthInfo> {
  const defaults: HealthInfo = {
    embeddingProvider: 'disabled',
    searchMode: 'BM25',
    backfillPending: 0,
    totalMemories: 0,
    activeMemories: 0,
    sessions: 0,
  };

  try {
    const { detectProject } = await import('../../project/detector.js');
    const { getProjectDataDir, loadObservationsJson } = await import('../../store/persistence.js');

    const proj = detectProject(process.cwd());
    if (!proj) return defaults;

    const dataDir = await getProjectDataDir(projectId || proj.id);
    const obs = await loadObservationsJson(dataDir) as any[];
    const active = obs.filter((o: any) => (o.status ?? 'active') === 'active');

    defaults.totalMemories = obs.length;
    defaults.activeMemories = active.length;

    // Count sessions
    try {
      const sessionsPath = `${dataDir}/sessions.json`;
      if (fs.existsSync(sessionsPath)) {
        const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf-8'));
        defaults.sessions = Array.isArray(sessions) ? sessions.length : 0;
      }
    } catch { /* ignore */ }

    // Real embedding provider state (not config heuristic)
    try {
      const { getEmbeddingProvider, isEmbeddingExplicitlyDisabled } = await import('../../embedding/provider.js');
      if (isEmbeddingExplicitlyDisabled()) {
        defaults.embeddingProvider = 'disabled';
      } else {
        const provider = await getEmbeddingProvider();
        defaults.embeddingProvider = provider ? 'ready' : 'unavailable';
      }
    } catch { /* ignore */ }

    // Real search mode from last actual search execution
    try {
      const { getLastSearchMode } = await import('../../store/orama-store.js');
      defaults.searchMode = getLastSearchMode();
    } catch { /* ignore */ }

    return defaults;
  } catch {
    return defaults;
  }
}

// ── Recent Memories ────────────────────────────────────────────

export async function getRecentMemories(limit = 8): Promise<MemoryItem[]> {
  try {
    const { detectProject } = await import('../../project/detector.js');
    const { getProjectDataDir, loadObservationsJson } = await import('../../store/persistence.js');

    const proj = detectProject(process.cwd());
    if (!proj) return [];

    const dataDir = await getProjectDataDir(proj.id);
    const obs = await loadObservationsJson(dataDir) as any[];
    const active = obs.filter((o: any) => (o.status ?? 'active') === 'active');

    // Filter out noise (Ran: / Command: prefixed titles)
    const filtered = active.filter((o: any) =>
      !/^(Ran:|Command:|Executed:)\s/i.test(o.title || '')
    );

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

// ── Search ─────────────────────────────────────────────────────

export async function searchMemories(query: string, limit = 10): Promise<SearchResult[]> {
  try {
    const { searchObservations, getDb } = await import('../../store/orama-store.js');
    const { getProjectDataDir } = await import('../../store/persistence.js');
    const { detectProject } = await import('../../project/detector.js');
    const { initObservations } = await import('../../memory/observations.js');

    const proj = detectProject(process.cwd());
    if (!proj) return [];

    const dataDir = await getProjectDataDir(proj.id);
    await initObservations(dataDir);
    await getDb();

    const results = await searchObservations({ query, limit, projectId: proj.id });

    const typeIcons: Record<string, string> = {
      gotcha: '!', decision: 'D', 'problem-solution': 'S', discovery: '?',
      'how-it-works': 'H', 'what-changed': 'C', 'trade-off': 'T', reasoning: 'R',
    };

    return results.map((r: any) => ({
      id: r.id,
      title: r.title || '(untitled)',
      type: r.type || 'discovery',
      score: r.score ?? 0,
      entityName: r.entityName || '',
      icon: typeIcons[r.type] || '·',
    }));
  } catch {
    return [];
  }
}

// ── Store Memory ───────────────────────────────────────────────

export async function storeQuickMemory(text: string): Promise<{ id: number; title: string } | null> {
  try {
    const { detectProject } = await import('../../project/detector.js');
    const { getProjectDataDir } = await import('../../store/persistence.js');
    const { initObservations, storeObservation } = await import('../../memory/observations.js');

    const proj = detectProject(process.cwd());
    if (!proj) return null;

    const dataDir = await getProjectDataDir(proj.id);
    await initObservations(dataDir);

    const result = await storeObservation({
      entityName: 'quick-note',
      type: 'discovery',
      title: text.slice(0, 100),
      narrative: text,
      facts: [],
      projectId: proj.id,
    });

    return { id: result.observation.id, title: text.slice(0, 100) };
  } catch {
    return null;
  }
}

// ── Background Status ──────────────────────────────────────────

export async function getBackgroundStatus(): Promise<BackgroundInfo> {
  const result: BackgroundInfo = { running: false, healthy: false };

  try {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const statePath = `${home.replace(/\\/g, '/')}/.memorix/background.json`;

    if (!fs.existsSync(statePath)) {
      // Check if port 3211 has an unmanaged instance
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`http://127.0.0.1:3211/api/team`, { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json() as any;
          result.running = true;
          result.healthy = true;
          result.port = 3211;
          result.dashboard = 'http://127.0.0.1:3211/';
          result.mcp = 'http://127.0.0.1:3211/mcp';
          result.agents = data.agents?.length ?? 0;
          result.sessions = data.sessions ?? 0;
          result.message = 'Foreground instance detected';
        }
      } catch { /* not running */ }
      return result;
    }

    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    result.pid = state.pid;
    result.port = state.port;
    result.startedAt = state.startedAt;
    result.dashboard = `http://127.0.0.1:${state.port}/`;
    result.mcp = `http://127.0.0.1:${state.port}/mcp`;

    // Check if process is alive
    try {
      process.kill(state.pid, 0);
      result.running = true;
    } catch {
      result.message = 'Process exited';
      return result;
    }

    // Health check
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`http://127.0.0.1:${state.port}/api/team`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json() as any;
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

// ── Doctor (lightweight) ───────────────────────────────────────

export async function getDoctorSummary(): Promise<DoctorResult> {
  const result: DoctorResult = { sections: [] };

  try {
    // Project
    const proj = await getProjectInfo();
    const projectItems: DoctorSection['items'] = [];
    if (proj) {
      projectItems.push({ label: 'Name', value: proj.name, status: 'ok' });
      projectItems.push({ label: 'ID', value: proj.id.slice(0, 16) + '…', status: 'info' });
      projectItems.push({ label: 'Remote', value: proj.gitRemote, status: proj.gitRemote !== 'none' ? 'ok' : 'warn' });
    } else {
      projectItems.push({ label: 'Project', value: 'Not detected (no .git)', status: 'error' });
    }
    result.sections.push({ title: 'Project', items: projectItems });

    // Health
    const health = await getHealthInfo(proj?.id);
    result.sections.push({
      title: 'Data',
      items: [
        { label: 'Total', value: `${health.totalMemories}`, status: 'info' },
        { label: 'Active', value: `${health.activeMemories}`, status: health.activeMemories > 0 ? 'ok' : 'warn' },
        { label: 'Sessions', value: `${health.sessions}`, status: 'info' },
      ],
    });

    // Embedding
    result.sections.push({
      title: 'Search',
      items: [
        { label: 'Mode', value: health.searchMode, status: 'info' },
        { label: 'Embedding', value: health.embeddingProvider, status: health.embeddingProvider === 'ready' ? 'ok' : 'info' },
      ],
    });

    // Background
    const bg = await getBackgroundStatus();
    result.sections.push({
      title: 'Background',
      items: [
        { label: 'Status', value: bg.healthy ? 'Running & Healthy' : bg.running ? 'Running (unhealthy)' : 'Not running', status: bg.healthy ? 'ok' : bg.running ? 'warn' : 'info' },
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

// ── Mode Detection ─────────────────────────────────────────────

export function detectMode(): { mode: string; detail: string } {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const statePath = `${home.replace(/\\/g, '/')}/.memorix/background.json`;
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      try {
        process.kill(state.pid, 0);
        return { mode: 'Background', detail: `port ${state.port}` };
      } catch { /* dead */ }
    }
  } catch { /* ignore */ }
  return { mode: 'CLI', detail: 'Quick Mode' };
}
