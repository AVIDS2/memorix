/**
 * Session service — surface-facing API for TUI session lifecycle.
 *
 * Encapsulates project detection, session-store init, and the
 * memory/session module so the TUI data layer doesn't reach into
 * low-level store internals directly.
 */

import type { SessionState } from './data.js';

async function resolveProject() {
  const { detectProject } = await import('../../project/detector.js');
  return detectProject(process.cwd());
}

async function ensureStore(projectId: string) {
  const { getProjectDataDir } = await import('../../store/persistence.js');
  const { initSessionStore } = await import('../../store/session-store.js');
  const dataDir = await getProjectDataDir(projectId);
  await initSessionStore(dataDir);
}

// ── Public API ──────────────────────────────────────────────────────

export async function getSessionState(projectId?: string): Promise<SessionState> {
  try {
    const proj = await resolveProject();
    if (!proj) return { status: 'unbound' };

    const effectiveId = projectId || proj.id;
    await ensureStore(effectiveId);

    const { getSessionStore } = await import('../../store/session-store.js');
    const allSessions = (await getSessionStore().loadAll()) as any[];
    const active = allSessions.find(
      (s: any) => s.projectId === effectiveId && s.status === 'active',
    );

    if (active) {
      return {
        status: 'bound',
        sessionId: active.id,
        startedAt: active.startedAt,
        agent: active.agent,
      };
    }

    return { status: 'unbound' };
  } catch {
    return { status: 'unbound' };
  }
}

export async function bindSession(): Promise<SessionState> {
  try {
    const proj = await resolveProject();
    if (!proj) return { status: 'error', error: 'No project detected' };

    const { startSession } = await import('../../memory/session.js');
    const { session, previousContext } = await startSession(proj.rootPath, proj.id, {
      agent: 'memorix-tui',
    });

    return {
      status: 'bound',
      sessionId: session.id,
      startedAt: session.startedAt,
      agent: session.agent,
      context: previousContext || undefined,
    };
  } catch (err) {
    return {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function unbindSession(sessionId: string): Promise<SessionState> {
  try {
    const proj = await resolveProject();
    if (!proj) return { status: 'error', error: 'No project detected' };

    const { endSession } = await import('../../memory/session.js');
    const ended = await endSession(proj.rootPath, sessionId);
    if (!ended) {
      return { status: 'error', error: `Session ${sessionId} not found` };
    }

    return { status: 'unbound' };
  } catch (err) {
    return {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
