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

import type { Observation, Session } from '../types.js';
import { resolveAliases } from '../project/aliases.js';
import { withFileLock } from '../store/file-lock.js';
import { loadObservationsJson, loadSessionsJson, saveSessionsJson } from '../store/persistence.js';

const PRIORITY_TYPES = new Set(['gotcha', 'decision', 'problem-solution', 'trade-off', 'discovery']);
const TYPE_EMOJI: Record<string, string> = {
  'gotcha': '🔶',
  'decision': '🟠',
  'problem-solution': '🟡',
  'trade-off': '⚖️',
  'discovery': '🟣',
  'how-it-works': '🔵',
  'what-changed': '🟢',
  'why-it-exists': '🟤',
  'session-request': '🎯',
};
const TYPE_WEIGHTS: Record<string, number> = {
  'gotcha': 6,
  'decision': 5.5,
  'problem-solution': 5.25,
  'trade-off': 4.75,
  'discovery': 4.25,
};
const NOISE_PATTERNS = [
  /\[测试\]/i,
  /\[test\]/i,
  /验证/i,
  /兼容/i,
  /\bcompat(?:ibility)?\b/i,
  /\bdemo\b/i,
  /展示/i,
  /全能力/i,
  /handoff/i,
  /交接/i,
  /for_memmcp_test/i,
  /\bbenchmark\b/i,
  /\bsandbox\b/i,
  /\bplayground\b/i,
];

// Command-trace observations (debug commands, shell output) are low-value noise
// in session context. They may have been stored by hooks but shouldn't surface.
const COMMAND_TRACE_PATTERNS = [
  /^Ran:\s/i,
  /^Command:\s/i,
  /^Executed:\s/i,
  /\b2>&1\b/,
  /\bSelect-String\b/i,
  /\bGet-Content\b/i,
  /\bnpx\s+vitest\b/i,
  /\bnpx\s+tsc\b/i,
];

// Observations about Memorix itself (its tools, internals, runtime modes) should almost
// never be injected into unrelated projects.  These get a much heavier penalty.
const SYSTEM_SELF_PATTERNS = [
  /memorix.demo/i,
  /memorix.*全能力/i,
  /memorix.*工具.*能力/i,
  /memorix.*runtime.*mode/i,
  /memorix.*运行模式/i,
  /memorix.*control.plane/i,
  /session.*inject(?:ion)?/i,
  /注入.*逻辑/i,
  /\b22\s*(?:个|tools?).*(?:工具|能力|capabilit)/i,
  /memorix.*(?:v\d|版本|version)/i,
  /memorix.*(?:兼容|compat)/i,
  /memorix.*(?:测试|test)/i,
  /memmcp/i,
];

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

function tokenizeProjectId(projectId: string): string[] {
  const leaf = projectId.split('/').at(-1) ?? projectId;
  return Array.from(
    new Set(
      leaf
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  );
}

function stringifyObservation(obs: Observation, includeFiles: boolean = true): string {
  const parts = [
    obs.title,
    obs.narrative,
    obs.entityName,
    ...(obs.facts ?? []),
    ...(obs.concepts ?? []),
  ];

  if (includeFiles) {
    parts.push(...(obs.filesModified ?? []));
  }

  return parts
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

function isCommandTrace(obs: Observation): boolean {
  const title = obs.title ?? '';
  return COMMAND_TRACE_PATTERNS.some((pattern) => pattern.test(title));
}

function isNoiseObservation(obs: Observation): boolean {
  const text = stringifyObservation(obs, false);
  return NOISE_PATTERNS.some((pattern) => pattern.test(text)) || isCommandTrace(obs);
}

function isSystemSelfObservation(obs: Observation): boolean {
  const text = stringifyObservation(obs, false);
  return SYSTEM_SELF_PATTERNS.some((pattern) => pattern.test(text));
}

function scoreObservationForSessionContext(obs: Observation, projectTokens: string[], now = Date.now()): number {
  let score = TYPE_WEIGHTS[obs.type] ?? 1;
  const text = stringifyObservation(obs);
  const ageDays = Math.max(0, (now - new Date(obs.createdAt).getTime()) / (1000 * 60 * 60 * 24));

  // Recency still matters, but should not dominate everything.
  score += Math.max(0.2, 2.5 - Math.min(ageDays, 45) * 0.05);

  // Prefer observations that mention the current project name or touch its paths.
  if (projectTokens.length > 0) {
    const matchingTokens = projectTokens.filter((token) => text.includes(token));
    if (matchingTokens.length > 0) {
      score += 2 + matchingTokens.length * 0.6;
    } else if ((obs.filesModified?.length ?? 0) > 0) {
      score -= 1.25;
    }
  }

  // Avoid injecting obviously stale or completed memories back into new sessions.
  if (obs.status === 'resolved' || obs.status === 'archived') {
    score -= 100;
  }

  // Downrank demos, tests, migrations, and handoff records.
  if (isNoiseObservation(obs)) {
    score -= 8;
  }

  // Heavy penalty for observations about Memorix itself (system self-reference).
  // These should almost never surface in unrelated project sessions.
  if (isSystemSelfObservation(obs)) {
    score -= 15;
  }

  return score;
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
    const session = sessions.find((entry) => entry.id === sessionId);

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

  const aliasSet = await resolveProjectIds(projectId);
  /** Check if a session summary contains noise/system-self content */
  const isNoisySummary = (summary: string | undefined): boolean => {
    if (!summary) return false;
    return NOISE_PATTERNS.some((p) => p.test(summary)) || SYSTEM_SELF_PATTERNS.some((p) => p.test(summary));
  };

  const projectSessions = sessions
    .filter((session) => aliasSet.has(session.projectId) && session.status === 'completed')
    .filter((session) => !isNoisySummary(session.summary))
    .sort((a, b) => new Date(b.endedAt || b.startedAt).getTime() - new Date(a.endedAt || a.startedAt).getTime())
    .slice(0, limit);

  if (projectSessions.length === 0 && allObs.length === 0) {
    return '';
  }

  const lines: string[] = [];

  if (projectSessions.length > 0) {
    const last = projectSessions[0];
    lines.push('## Previous Session');
    if (last.agent) {
      lines.push(`Agent: ${last.agent}`);
    }
    lines.push(`Ended: ${last.endedAt || last.startedAt}`);
    if (last.summary && last.summary !== '(session ended implicitly by new session start)') {
      lines.push('', last.summary);
    }
    lines.push('');
  }

  const projectTokens = tokenizeProjectId(projectId);
  const priorityObs = allObs
    .filter((obs) => aliasSet.has(obs.projectId) && PRIORITY_TYPES.has(obs.type) && (obs.status ?? 'active') === 'active')
    .filter((obs) => !isNoiseObservation(obs) && !isSystemSelfObservation(obs))
    .map((obs) => ({ obs, score: scoreObservationForSessionContext(obs, projectTokens) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.obs.createdAt).getTime() - new Date(a.obs.createdAt).getTime();
    })
    .slice(0, 5)
    .map(({ obs }) => obs);

  if (priorityObs.length > 0) {
    lines.push('## Key Memories');
    for (const obs of priorityObs) {
      const emoji = TYPE_EMOJI[obs.type] ?? '📌';
      const fact = obs.facts?.[0] ? ` — ${obs.facts[0]}` : '';
      lines.push(`${emoji} ${obs.title}${fact}`);
    }
    lines.push('');
  }

  if (projectSessions.length > 1) {
    lines.push(`## Session History (last ${projectSessions.length})`);
    for (const session of projectSessions) {
      const date = (session.endedAt || session.startedAt).slice(0, 10);
      const agent = session.agent ? ` [${session.agent}]` : '';
      const summary = session.summary
        ? ` — ${session.summary.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80)}`
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
    return sessions.filter((session) => aliasSet.has(session.projectId));
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
  return sessions.find((session) => aliasSet.has(session.projectId) && session.status === 'active') || null;
}
