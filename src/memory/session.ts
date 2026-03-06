/**
 * Session Lifecycle Manager
 *
 * Tracks coding sessions across agents and provides context injection
 * for new sessions. Inspired by Engram's session management pattern.
 *
 * Key features:
 * - Start/end session tracking
 * - Structured session summaries (Goal/Discoveries/Accomplished/Files)
 * - Auto-inject previous session context on session start
 * - Cross-agent session awareness (all agents share session data)
 */

import type { Session, Observation } from '../types.js';
import { loadSessionsJson, saveSessionsJson, loadObservationsJson } from '../store/persistence.js';
import { withFileLock } from '../store/file-lock.js';
import { resolveAliases } from '../project/aliases.js';

/**
 * Resolve a projectId into a Set of all known aliases.
 * Ensures sessions stored under any alias are found regardless of which IDE stored them.
 */
async function resolveProjectIds(projectId: string): Promise<Set<string>> {
  try {
    const aliases = await resolveAliases(projectId);
    return new Set(aliases);
  } catch {
    return new Set([projectId]);
  }
}

/**
 * Generate a unique session ID.
 */
function generateSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `sess-${ts}-${rand}`;
}

/**
 * Start a new coding session.
 *
 * Creates a session record and returns context from previous sessions
 * so the agent can resume work without re-explaining everything.
 */
export async function startSession(
  projectDir: string,
  projectId: string,
  opts?: { sessionId?: string; agent?: string },
): Promise<{ session: Session; previousContext: string }> {
  const sessionId = opts?.sessionId || generateSessionId();
  const now = new Date().toISOString();

  const session: Session = {
    id: sessionId,
    projectId,
    startedAt: now,
    status: 'active',
    agent: opts?.agent,
  };

  // Load previous context before creating new session
  const previousContext = await getSessionContext(projectDir, projectId);

  // Persist with file lock
  await withFileLock(projectDir, async () => {
    const sessions = await loadSessionsJson(projectDir) as Session[];

    // Mark any existing active sessions as completed (stale)
    const aliasSet = await resolveProjectIds(projectId);
    for (const s of sessions) {
      if (aliasSet.has(s.projectId) && s.status === 'active') {
        s.status = 'completed';
        s.endedAt = now;
        if (!s.summary) {
          s.summary = '(session ended implicitly by new session start)';
        }
      }
    }

    sessions.push(session);
    await saveSessionsJson(projectDir, sessions);
  });

  return { session, previousContext };
}

/**
 * End a coding session with an optional structured summary.
 *
 * Summary format (following Engram's convention):
 * ## Goal
 * ## Discoveries
 * ## Accomplished
 * ## Relevant Files
 */
export async function endSession(
  projectDir: string,
  sessionId: string,
  summary?: string,
): Promise<Session | null> {
  let endedSession: Session | null = null;

  await withFileLock(projectDir, async () => {
    const sessions = await loadSessionsJson(projectDir) as Session[];
    const session = sessions.find(s => s.id === sessionId);

    if (!session) return;

    session.status = 'completed';
    session.endedAt = new Date().toISOString();
    if (summary) {
      session.summary = summary;
    }

    endedSession = session;
    await saveSessionsJson(projectDir, sessions);
  });

  return endedSession;
}

/**
 * Get formatted context from previous sessions for injection into a new session.
 *
 * Returns a concise summary of:
 * 1. Last completed session's summary (if available)
 * 2. Top observations from recent sessions
 * 3. Active decisions and gotchas
 */
export async function getSessionContext(
  projectDir: string,
  projectId: string,
  limit: number = 3,
): Promise<string> {
  const sessions = await loadSessionsJson(projectDir) as Session[];
  const allObs = await loadObservationsJson(projectDir) as Observation[];

  // Get recent completed sessions for this project (newest first)
  const aliasSet = await resolveProjectIds(projectId);
  const projectSessions = sessions
    .filter(s => aliasSet.has(s.projectId) && s.status === 'completed')
    .sort((a, b) => new Date(b.endedAt || b.startedAt).getTime() - new Date(a.endedAt || a.startedAt).getTime())
    .slice(0, limit);

  if (projectSessions.length === 0 && allObs.length === 0) {
    return '';
  }

  const lines: string[] = [];

  // Last session summary
  if (projectSessions.length > 0) {
    const last = projectSessions[0];
    lines.push(`## Previous Session`);
    if (last.agent) {
      lines.push(`Agent: ${last.agent}`);
    }
    lines.push(`Ended: ${last.endedAt || last.startedAt}`);
    if (last.summary && last.summary !== '(session ended implicitly by new session start)') {
      lines.push('');
      lines.push(last.summary);
    }
    lines.push('');
  }

  // High-priority recent observations (gotchas, decisions, discoveries)
  const PRIORITY_TYPES = new Set(['gotcha', 'decision', 'problem-solution', 'trade-off', 'discovery']);
  const TYPE_EMOJI: Record<string, string> = {
    'gotcha': '🔴', 'decision': '🟤', 'problem-solution': '🟡',
    'trade-off': '⚖️', 'discovery': '🟣', 'how-it-works': '🔵',
    'what-changed': '🟢', 'why-it-exists': '🟠', 'session-request': '🎯',
  };

  const priorityObs = allObs
    .filter(o => aliasSet.has(o.projectId) && PRIORITY_TYPES.has(o.type))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  if (priorityObs.length > 0) {
    lines.push(`## Key Memories`);
    for (const obs of priorityObs) {
      const emoji = TYPE_EMOJI[obs.type] ?? '📌';
      const fact = obs.facts?.[0] ? ` — ${obs.facts[0]}` : '';
      lines.push(`${emoji} ${obs.title}${fact}`);
    }
    lines.push('');
  }

  // Session history summary
  if (projectSessions.length > 1) {
    lines.push(`## Session History (last ${projectSessions.length})`);
    for (const s of projectSessions) {
      const date = (s.endedAt || s.startedAt).slice(0, 10);
      const agent = s.agent ? ` [${s.agent}]` : '';
      const summary = s.summary
        ? ` — ${s.summary.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80)}`
        : '';
      lines.push(`- ${date}${agent}${summary}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * List all sessions for a project.
 */
export async function listSessions(
  projectDir: string,
  projectId?: string,
): Promise<Session[]> {
  const sessions = await loadSessionsJson(projectDir) as Session[];
  if (projectId) {
    const aliasSet = await resolveProjectIds(projectId);
    return sessions.filter(s => aliasSet.has(s.projectId));
  }
  return sessions;
}

/**
 * Get the currently active session for a project (if any).
 */
export async function getActiveSession(
  projectDir: string,
  projectId: string,
): Promise<Session | null> {
  const sessions = await loadSessionsJson(projectDir) as Session[];
  const aliasSet = await resolveProjectIds(projectId);
  return sessions.find(s => aliasSet.has(s.projectId) && s.status === 'active') || null;
}
